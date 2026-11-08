/** Filesystem defense for paths under DATA_DIR/tenants. Owner paths unchanged.
 * O_NOFOLLOW prevents following the final symlink at open; ancestors are checked
 * before/after. This does NOT provide openat2/dirfd atomic ancestor containment.
 * A hostile same-UID process able to rename directories concurrently remains
 * outside this guard's guarantee and must not be given tenant filesystem access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config/paths.js';
const root = path.resolve(DATA_DIR);
const tenants = path.join(root, 'tenants');
function scoped(p) { return typeof p === 'string' && path.resolve(p).startsWith(tenants + path.sep); }
function error() { const e = new Error('Almacenamiento de tenant no seguro.'); e.name = 'AlmacenamientoTenant'; return e; }
export function comprobarRutaTenant(p) {
  if (!scoped(p)) return;
  const abs = path.resolve(p);
  if (fs.existsSync(root) && (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root)) throw error();
  let current = root;
  for (const n of path.relative(root, abs).split(path.sep)) {
    current = path.join(current, n);
    let st;
    try { st = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || (st.isFile() && st.nlink > 1) || fs.realpathSync(current) !== current) throw error();
  }
}
function opened(p, flags, fn) {
  comprobarRutaTenant(p);
  const fd = fs.openSync(p, flags | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw error();
    comprobarRutaTenant(p);
    return fn(fd);
  } finally { fs.closeSync(fd); }
}
const overrides = {
  readFileSync(p, opts) { return scoped(p) ? opened(p, fs.constants.O_RDONLY, (fd) => fs.readFileSync(fd, opts)) : fs.readFileSync(p, opts); },
  writeFileSync(p, data, opts) {
    if (!scoped(p)) return fs.writeFileSync(p, data, opts);
    const flag = typeof opts === 'object' && opts?.flag ? opts.flag : 'w';
    if (flag !== 'w' && flag !== 'a' && flag !== 'wx') throw error();
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | (flag === 'a' ? fs.constants.O_APPEND : 0) | (flag === 'wx' ? fs.constants.O_EXCL : 0);
    return opened(p, flags, (fd) => { if (flag !== 'a') fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, data, opts); });
  },
  appendFileSync(p, data, opts) { return scoped(p) ? overrides.writeFileSync(p, data, { ...(typeof opts === 'string' ? { encoding: opts } : opts), flag: 'a' }) : fs.appendFileSync(p, data, opts); },
  mkdirSync(p, opts) { comprobarRutaTenant(p); const r = fs.mkdirSync(p, opts); comprobarRutaTenant(p); return r; },
  renameSync(a, b) { comprobarRutaTenant(a); comprobarRutaTenant(b); return fs.renameSync(a, b); },
  readdirSync(p, opts) { comprobarRutaTenant(p); return fs.readdirSync(p, opts); }
};
export default new Proxy(fs, { get(target, k) { return overrides[k] || target[k]; } });
