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
def return_observer(app_id):
    value=json.loads((Path(directory)/('synthetic-observation-'+role+'.json')).read_text())
    return value[str(app_id)] if 'app' not in value else value
pair=Pair(store,lease,c,remote,source_digest(),apps,donor=role=='donor',return_observer=return_observer)
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
            elif command=='RUNNER_SEQUENCE':
                from deploy.ers_recovery.local_runner import LocalRunner
                from deploy.ers_recovery.campaign import GATES
                from deploy.ers_recovery.policy import Health
                import copy
                baseline={i:{'observationSchema':2,'id':i,'name':'api' if i==0 else 'wa','pid':100+i,'start':str(10+i),'status':'online','configDigest':'api-sha' if i==0 else 'wa-sha','restart_time':0,'pm_uptime':100000} for i in (0,1)}
                runner=LocalRunner(pair,baseline,{k:True for k in GATES},at=0)
                for i,t in ((0,1),(1,2)):
                    runner.stop_candidate(i,at=t);r=copy.deepcopy(baseline[i]);r.update(pid=0,status='stopped');runner.observe_stop(r,at=t+.1,original_absent=True)
                runner.rehearsal_candidate(at=3);runner.observe_rehearsal(at=4,no_real_effects=True)
                for i,t in ((0,5),(1,6)):
                    runner.return_candidate(i,at=t);r=copy.deepcopy(baseline[i]);r.update(pid=1000+i);runner.observe_return(r,at=t+.1,start=str(50+i))
                def h(i,t):return Health(1000+i,50+i,0,100000,100000+int(t*1000))
                runner.begin_stability((401,'Unauthorized'),h(0,7),h(1,7),at=7)
                for t in range(7,83,5):runner.stability_sample(t,h(0,t),h(1,t),(401,'Unauthorized'),listener_owned=True,wa_connected=True)
                result=runner.verify_exit(at=83,reconciled=True)
            elif command=='RETURN_COMMIT_CHANGED':
                original=store.write
                def changed_after_write(state):
                    original(state)
                    observation=Path(directory)/'synthetic-observation-receiver.json'
                    value=json.loads(observation.read_text());value['originalAbsent']=False;observation.write_text(json.dumps(value))
                store.write=changed_after_write
                try:result=pair.connected_start_intent(0)
                finally:store.write=original
            elif command.startswith('RETURN_ACK'):
                import deploy.ers_recovery.paired as paired
                original=paired.receive_record;calls=[0];which=int(command[-1])
                def lost_return(channel):
                    result=original(channel);calls[0]+=1
                    if calls[0]==which:raise TimeoutError('synthetic return ACK loss')
                    return result
                paired.receive_record=lost_return
                try:result=pair.connected_start_intent(0)
                finally:paired.receive_record=original
            elif command.startswith('RETURN'):
                result=pair.connected_start_intent(int(command[6:]))
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
