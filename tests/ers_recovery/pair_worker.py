"""Synthetic local test actor only, no production service entry point."""
import json
import os
from pathlib import Path
import select
import socket
import sys
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from deploy.ers_recovery.composition import Store
from deploy.ers_recovery.lease import Lease,identity
from deploy.ers_recovery.paired import Pair,source_digest
from deploy.ers_recovery.policy import App
role,directory,lockpath,sockpath=sys.argv[1:5]
apps=[App(0,'api-sha',100,10,'online'),App(1,'wa-sha',101,11,'online')]
store=Store(directory)
if role=='donor':
    lease=Lease.acquire_existing(lockpath)
    listener=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);listener.bind(sockpath);listener.listen(1)
    print(json.dumps({'identity':identity(),'epoch':lease.epoch,'source':source_digest()}),flush=True)
    c,_=listener.accept();listener.close();c.settimeout(2)
    remote=json.loads(sys.stdin.readline());lease.offer(c,remote)
else:
    config=json.loads(sys.argv[5]);remote=config['identity']
    c=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET);c.settimeout(2);c.connect(sockpath)
    print(json.dumps(identity()),flush=True)
    lease=Lease.accept(c,remote,lockpath,config['epoch'])
pair=Pair(store,lease,c,remote,source_digest(),apps,donor=role=='donor')
print('READY',flush=True)
monitor=True
try:
    while True:
        watched=[sys.stdin]+([c] if role=='receiver' and monitor else [])
        ready,_,_=select.select(watched,[],[],5)
        if not ready:continue
        if c in ready:
            try:
                result=pair.service_once()
                if result=='CHANNEL_CLOSED_NOT_DEATH_PROOF':monitor=False
            except BaseException as e:
                monitor=False
                # keep process/reference alive to permit inspection, not retry.
            continue
        command=sys.stdin.readline().strip()
        if not command:break
        try:
            if command=='ENROLL':result=pair.enroll()
            elif command.startswith('STOP'):result=pair.stop_intent(int(command[4:]))
            elif command.startswith('FAULT_ACK'):
                import deploy.ers_recovery.paired as paired
                original=paired.receive_record;calls=[0];which=int(command[-1])
                def lost(channel):
                    result=original(channel);calls[0]+=1
                    if calls[0]==which:raise TimeoutError('synthetic ACK loss after delivery')
                    return result
                paired.receive_record=lost
                try:result=pair.stop_intent(0)
                finally:paired.receive_record=original
            elif command=='FAULT_POSTPERSIST':
                original=store.write
                def fail_after(state):
                    original(state)
                    raise OSError('synthetic failure after durable write before COMMIT')
                store.write=fail_after
                try:result=pair.stop_intent(0)
                finally:store.write=original
            elif command=='FAULT_PERSIST':
                original=store.write
                def fail(state):raise OSError('synthetic persist failure after PREPARE')
                store.write=fail
                try:result=pair.stop_intent(0)
                finally:store.write=original
            elif command=='GONE':result=pair.peer_gone();monitor=False
            elif command.startswith('START'):
                i=int(command[5:]);result=pair.survivor_start_intent(App(i,'api-sha' if i==0 else 'wa-sha',0,0,'stopped'),same_daemon=True,same_release=True,original_absent=True)
            elif command=='LIVE':result={'live':pair.live,'pending':pair.pending,'failed':pair.failed,'reference':lease.validate()}
            elif command=='CLOSEFD':lease.close();result='CLOSED'
            elif command=='EXIT':print(json.dumps({'result':'EXIT'}),flush=True);break
            else:raise ValueError('unsupported test command')
            print(json.dumps({'result':result}),flush=True)
        except BaseException as e:print(json.dumps({'error':type(e).__name__+':'+str(e)}),flush=True)
finally:
    c.close();lease.close();store.close()
