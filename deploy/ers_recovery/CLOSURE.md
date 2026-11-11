# Closed read-only transport source graph

This is a new local caller delta on reviewed v9. No production require, socket
RPC, host installation, service mutation or stability claim follows from it.

## Provenance

The fixed manifest pins 29 JavaScript files and 59 literal require edges from:

- https://registry.npmjs.org/pm2/-/pm2-7.1.1.tgz
- https://registry.npmjs.org/debug/-/debug-4.4.3.tgz
- https://registry.npmjs.org/amp/-/amp-0.3.1.tgz
- https://registry.npmjs.org/amp-message/-/amp-message-0.1.2.tgz
- https://registry.npmjs.org/ms/-/ms-2.1.3.tgz

Each tarball's SHA512 matched its registry version record integrity before
source extraction. This pins a reviewed source selection, not what the host
has installed or what its running daemon previously loaded. The host must
match every selected path hash before this caller can load any of these files.
A different installed dependency version causes a hold, never a runtime
fallback to whichever file Node happens to find.

The bundled PM2 axon and RPC modules do not contain package.json in the exact
7.1.1 tarball. Their index files include all socket constructors and the RPC
Server export. The manifest preserves that graph, not a guessed older layout.

## Preflight and loading

The only root is /usr/lib/node_modules/pm2. Every selected file and its ancestor
is inspected before any external module executes. Directories must have an
identical realpath, root ownership and no group/world write bit. Regular files
must additionally have one link, no symlink, bounded size, stable FD/path
identity and the exact manifest hash. All verified source is retained in
memory; later module loads do not re-read package files. Symlinks outside this
closed graph are not used and cannot change any edge.

The graph has explicit source-relative and bare-module mappings. It does not
call Node's package resolver, search package.json, look above the root, consult
NODE_PATH or reuse the global require cache. All listed builtins are resolved
with node: names before external loading. Every external module receives an
instance-local require method with exactly its declared edges. Its local cache
preserves CJS export/cycle behavior and is isolated from other loaders.

This is not a security sandbox for malicious reviewed code. These are known,
hash-pinned source bytes. They have Node's ordinary process and builtin powers.
Their actual source graph uses literal require calls; it does not use eval,
dynamic import, require.resolve, module.require bypasses or native addons.
Changing a pin or graph requires source review, not just recalculating a hash.
Module._compile is used on an individual module instance. No global loader or
resolver hook is installed, and global cache entries are neither read nor
changed by this loader.

## Explicit optional dependency semantic change

debug 4.4.3 tries supports-color inside a catch. That edge is deliberately
represented as unavailable (MODULE_NOT_FOUND) without a lookup or external
load. debug's own fallback handles the absence. Thus optional color detection
is disabled even if some ancestor directory has supports-color installed.
The caller has no DEBUG environment and discards stderr. This differs from an
unrestricted stock Node resolution; it does not change RPC methods/payloads.
No other optional edge or missing dependency may take this route.

## Remaining live checks

The earlier whole-package metadata census is not proof of this graph: it did
not identify two symlinks and reported four overlapping unsafe flags. Nothing
here reclassifies that observation as safe. The minimum next observation is
metadata, realpaths, ancestors and hashes for the manifest's 29 files and
relevant parent directories only. No second inventory of the 2471-file package
is needed. The fixed Node executable identity/hash/version, daemon/socket
custody, exact process projection and global deadline still apply separately.

A local successful load through synthetic root-owned metadata proves source
compatibility of the selected 29 files and export availability only. It does
not prove host custody, Node20 compatibility, live RPC or production recovery.
