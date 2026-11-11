"""Linux cooperative deploy exclusion primitive. Not an executable maintenance plan.

Only close() releases this holder's reference. Never LOCK_UN or downgrade a
shared open-file-description. Independent holders must serialize actions using
another journal lock. No process-management or production paths live here.
"""
import array
import fcntl
import json
import os
from pathlib import Path
import socket
import stat
import struct
import uuid


class UnsafeLease(RuntimeError):
    pass


def identity(pid=None):
    pid = os.getpid() if pid is None else pid
    raw = Path(f'/proc/{pid}/stat').read_text()
    return {'pid': pid, 'start': raw[raw.rfind(')') + 2:].split()[19],
            'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def peer(channel, expected):
    pid, uid, _ = struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if uid != os.getuid() or identity(pid) != expected:
        raise UnsafeLease('PEER_IDENTITY_CHANGED')


def record(channel, value):
    data = json.dumps(value, sort_keys=True).encode()
    if len(data) > 4096 or channel.type != socket.SOCK_SEQPACKET:
        raise UnsafeLease('BAD_CONTROL_RECORD')
    if channel.send(data) != len(data):
        raise UnsafeLease('SHORT_SEND')


def receive_record(channel):
    data, ancillary, flags, _ = channel.recvmsg(4096, socket.CMSG_SPACE(16))
    # Close unsolicited descriptors, including records rejected before JSON parsing.
    for level, kind, payload in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            fds = array.array('i'); fds.frombytes(payload[:len(payload) - len(payload) % fds.itemsize])
            for fd in fds: os.close(fd)
    if ancillary or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
        raise UnsafeLease('UNEXPECTED_CONTROL_DATA')
    return json.loads(data)


class Lease:
    def __init__(self, fd, path, epoch):
        self.fd, self.path, self.epoch = fd, os.fspath(path), epoch
        self.key = self._key(os.fstat(fd))
        os.set_inheritable(fd, False)

    @staticmethod
    def _key(s):
        return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode))

    @classmethod
    def acquire_existing(cls, path):
        # Creating or repairing the production lock is outside this primitive.
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            before = os.lstat(path)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise UnsafeLease('UNSAFE_LOCK_FILE')
            if cls._key(before) != cls._key(os.fstat(fd)):
                raise UnsafeLease('LOCK_PATH_RACE')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = cls(fd, path, uuid.uuid4().hex)
            result.validate()
            return result
        except BaseException:
            os.close(fd)
            raise

    def validate(self):
        if self.fd is None:
            raise UnsafeLease('REFERENCE_CLOSED')
        live = os.lstat(self.path)
        own = os.fstat(self.fd)
        if (not stat.S_ISREG(live.st_mode) or live.st_nlink != 1 or own.st_nlink != 1
                or self._key(live) != self.key or self._key(own) != self.key):
            raise UnsafeLease('LOCK_PATH_CHANGED')
        if os.get_inheritable(self.fd):
            raise UnsafeLease('FD_MAY_LEAK_ACROSS_EXEC')
        info = Path(f'/proc/self/fdinfo/{self.fd}').read_text()
        locks = [line.split() for line in info.splitlines() if line.startswith('lock:')]
        if len(locks) != 1 or locks[0][2:5] != ['FLOCK', 'ADVISORY', 'WRITE']:
            raise UnsafeLease('EXCLUSIVE_FLOCK_NOT_OBSERVED')
        return {'epoch': self.epoch, 'key': list(self.key)}

    def offer(self, channel, expected_peer):
        """Bounded socket timeout is caller-owned. ACK is transport, not durable commit."""
        if channel.type != socket.SOCK_SEQPACKET:
            raise UnsafeLease('SEQPACKET_REQUIRED')
        peer(channel, expected_peer)
        packet = self.validate()
        packet['nonce'] = uuid.uuid4().hex
        encoded = json.dumps(packet, sort_keys=True).encode()
        sent = channel.sendmsg([encoded], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [self.fd]))])
        if sent != len(encoded):
            raise UnsafeLease('TRANSFER_UNCONFIRMED')
        ack = receive_record(channel)
        peer(channel, expected_peer)
        self.validate()
        if ack != packet:
            raise UnsafeLease('TRANSFER_ACK_MISMATCH')
        return packet

    @classmethod
    def accept(cls, channel, expected_peer, path, expected_epoch):
        if channel.type != socket.SOCK_SEQPACKET:
            raise UnsafeLease('SEQPACKET_REQUIRED')
        peer(channel, expected_peer)
        data, ancillary, flags, _ = channel.recvmsg(4096, socket.CMSG_SPACE(16), socket.MSG_CMSG_CLOEXEC)
        fds = []
        result = None
        try:
            for level, kind, payload in ancillary:
                if level != socket.SOL_SOCKET or kind != socket.SCM_RIGHTS:
                    raise UnsafeLease('BAD_ANCILLARY_DATA')
                a = array.array('i'); a.frombytes(payload[:len(payload) - len(payload) % a.itemsize]); fds.extend(a)
            if len(fds) != 1 or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
                raise UnsafeLease('BAD_DESCRIPTOR_COUNT_OR_TRUNCATION')
            packet = json.loads(data)
            if set(packet) != {'epoch', 'key', 'nonce'} or packet['epoch'] != expected_epoch:
                raise UnsafeLease('WRONG_TRANSFER_EPOCH')
            result = cls(fds[0], path, expected_epoch)
            if result.validate()['key'] != packet['key']:
                raise UnsafeLease('TRANSFER_INODE_MISMATCH')
            peer(channel, expected_peer)
            record(channel, packet)
            return result
        except BaseException:
            for fd in fds: os.close(fd)
            if result is not None: result.fd = None
            raise

    def close(self):
        if self.fd is not None:
            fd, self.fd = self.fd, None
            os.close(fd)
