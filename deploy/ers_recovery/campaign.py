"""Bounded LOCAL state rehearsal, no production backend or effects.

Exercises complete ordering and interruption semantics without pretending that
caller dictionaries attest OS state or that timeout proves nonexecution. This
module never imports PM2, subprocess, files, vault, network or a service adapter.
"""
import copy
import math
from .observations import OBSERVATION_SCHEMA, reconcile_observation

class CampaignHold(RuntimeError):pass

ACTIONS=('STOP_PENDING','VERIFY_STOP','REHEARSAL','START_PENDING','VERIFY_START','OBSERVE_STABILITY','VERIFY_EXIT')
GATES=('source_revision_reviewed','remote_ancestry_reconciled','owner_effect_scope',
       'deploy_actor_exclusion_shared_ofd','two_live_committed_holders',
       'schema2_fresh_exact_process_baseline','daemon_socket_source_custody',
       'effective_scheduler_watcher_constraints','interpreter_execution_binding',
       'loaded_unit_source_and_invocation','exact_cgroup_containment_and_resource_admission',
       'single_retained_recovery_route','whatsapp_log_pid_interval_binding',
       'backup_scope_and_restore_limits','inflight_external_effect_reconciliation')

class LocalCampaign:
    """Synthetic evidence only. Output is an intent candidate, never an action.

    Production admission is unconditionally false. Supplying true gate booleans
    only permits local rehearsal: they are not attestation or owner approval.
    No constructor can resume a prior campaign from serialized state.
    """
    def __init__(self, baseline, gates, *, at, budget=240):
        if (type(baseline) is not dict or set(baseline)!={0,1}
                or any(r.get('id')!=i or r.get('observationSchema')!=OBSERVATION_SCHEMA
                       or r.get('status')!='online' or type(r.get('pid')) is not int or r['pid']<=0
                       or type(r.get('start')) is not str or not r['start'].isascii() or not r['start'].isdigit()
                       or not r.get('configDigest') for i,r in baseline.items())):
            raise CampaignHold('INVALID_SCHEMA2_BASELINE')
        if type(gates) is not dict or set(gates)!=set(GATES) or any(type(v) is not bool for v in gates.values()):
            raise CampaignHold('EXACT_GATE_SET_REQUIRED')
        if type(at) not in (int,float) or not math.isfinite(at) or at<0 or type(budget) not in (int,float) or not 80<=budget<=300:
            raise CampaignHold('INVALID_LOCAL_TIME_BUDGET')
        self.baseline=copy.deepcopy(baseline);self.gates=copy.deepcopy(gates)
        self.initial=at;self.last=at;self.deadline=at+budget
        self.phase='PREPARED';self.failed=False;self.actions=[];self.stops=set();self.starts=set();self.stopped=set();self.running={}
        self.pending=None;self.stability=None
    def _guard(self, at, custody):
        if self.failed:raise CampaignHold('CAMPAIGN_ALREADY_HELD')
        if type(at) not in (int,float) or not math.isfinite(at) or not self.last<=at<=self.deadline:
            self.failed=True;raise CampaignHold('GLOBAL_BUDGET_OR_MONOTONICITY')
        self.last=at
        if custody is not True:
            self.failed=True;raise CampaignHold('CUSTODY_UNCERTAIN_NO_OLD_BASELINE_ACTION')
        if not all(self.gates.values()):
            self.failed=True;raise CampaignHold('UNRESOLVED_ADMISSION_GATES')
    def candidate(self, action, app=None, *, at, custody):
        self._guard(at,custody)
        try:
            if self.pending is not None:raise CampaignHold('PENDING_OUTCOME_NO_RETRY')
            if action=='STOP_PENDING':
                if self.phase not in ('PREPARED','STOPPING') or type(app) is not int or app not in (0,1) or app in self.stops:raise CampaignHold('STOP_SEQUENCE')
                self.stops.add(app);self.phase='STOPPING'
            elif action=='REHEARSAL':
                if self.stopped!={0,1} or self.phase!='STOPPING':raise CampaignHold('BOTH_STOPS_REQUIRED')
                self.phase='REHEARSING'
            elif action=='START_PENDING':
                if self.phase not in ('RETURNING','STARTING') or type(app) is not int or app not in self.stopped or app in self.starts:raise CampaignHold('START_SEQUENCE')
                self.starts.add(app);self.phase='STARTING'
            elif action=='OBSERVE_STABILITY':
                if self.phase!='STARTING' or set(self.running)!={0,1}:raise CampaignHold('BOTH_RETURNS_REQUIRED')
                self.phase='OBSERVING'
            elif action=='VERIFY_EXIT':
                if self.phase!='OBSERVING' or self.stability!='OPERATIONAL_EQUIVALENCE_SAMPLED':raise CampaignHold('STABILITY_REQUIRED')
                self.phase='EXIT_PENDING'
            else:raise CampaignHold('UNSUPPORTED_ACTION_NO_RESTORE_DELETE_SAVE')
            result={'mode':'LOCAL_SYNTHETIC_CANDIDATE','productionAdmission':False,'action':action,'app':app,'sequence':len(self.actions)+1}
            self.pending=copy.deepcopy(result);self.actions.append(copy.deepcopy(result));return result
        except BaseException:self.failed=True;raise
    def observed(self, result, *, at, custody, record=None, original_absent=False, current_start=None):
        self._guard(at,custody)
        try:
            if self.pending is None:raise CampaignHold('NO_PENDING_INTENT')
            action=self.pending['action'];app=self.pending['app']
            if action=='STOP_PENDING':
                if result!='VERIFY_STOP' or record is None or reconcile_observation('STOP_PENDING',self.baseline[app],record,original_absent=original_absent,current_start=current_start)!='STOP_OBSERVED':raise CampaignHold('STOP_OUTCOME_UNCERTAIN')
                self.stopped.add(app)
            elif action=='REHEARSAL':
                if result!='REHEARSAL_NO_REAL_EFFECTS_CONFIRMED':raise CampaignHold('REHEARSAL_UNCERTAIN')
                self.phase='RETURNING'
            elif action=='START_PENDING':
                if result!='VERIFY_START' or record is None or reconcile_observation('START_PENDING',self.baseline[app],record,original_absent=original_absent,current_start=current_start)!='START_OBSERVED_NEEDS_STABILITY':raise CampaignHold('RETURN_OUTCOME_UNCERTAIN')
                self.running[app]=copy.deepcopy(record)
            elif action=='OBSERVE_STABILITY':
                if result!='OPERATIONAL_EQUIVALENCE_SAMPLED':raise CampaignHold('STABILITY_UNCERTAIN')
                self.stability=result
            elif action=='VERIFY_EXIT':
                if result!='OWNED_EFFECTS_RECONCILED_EXIT_VERIFIED':raise CampaignHold('EXIT_UNCERTAIN_KEEP_CUSTODY')
                self.phase='LOCAL_COMPLETE_NO_PRODUCTION_EFFECTS'
            else:raise CampaignHold('UNSUPPORTED_PENDING_ACTION')
            self.pending=None
        except BaseException:self.failed=True;raise
    def snapshot(self):
        return copy.deepcopy({'mode':'LOCAL_REHEARSAL_ONLY','productionAdmission':False,
                              'phase':self.phase,'held':self.failed,'pending':self.pending,
                              'actions':self.actions,'deadline':self.deadline})
