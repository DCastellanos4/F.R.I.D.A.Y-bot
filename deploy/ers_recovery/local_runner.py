"""Prepared integrated LOCAL runner: paired durable candidates + ordered campaign.

No production backend, process service effects, installer or admission override.
The exact injected pair is expected to be the caller's original live Pair; this
local class does not instantiate/adopt it from an ID or saved journal.
"""
from .campaign import LocalCampaign,CampaignHold
from .policy import Stability

class LocalRunner:
    def __init__(self,pair,baseline,gates,*,at,budget=240):
        self.pair=pair;self.campaign=LocalCampaign(baseline,gates,at=at,budget=budget)
        self.observer=None;self.held=False;self.return_starts={}
        for i,r in self.campaign.baseline.items():
            b=pair.baselines[str(i)]['baseline']
            if (b['app_id'],b['config'],b['pid'],str(b['start']),b['status'])!=(i,r['configDigest'],r['pid'],r['start'],r['status']):
                raise CampaignHold('PAIR_CAMPAIGN_BASELINE_MISMATCH')
    def _custody(self):
        # Snapshot equality to both committed memories is verified by Pair's
        # CENSUS exchange, not manufactured from the journal JSON.
        if self.held:raise CampaignHold('RUNNER_HELD')
        self.pair._check_journal()
        answer=self.pair._request({'op':'CENSUS'})
        from .paired import digest
        if answer.get('state')!=digest(self.pair.live):raise CampaignHold('PAIR_CENSUS_MISMATCH')
        return True
    def _hold(self):
        self.held=True;self.campaign.failed=True
    def stop_candidate(self,app,*,at):
        try:
            self.campaign.candidate('STOP_PENDING',app,at=at,custody=self._custody())
            result=self.pair.stop_intent(app)
            if result!='SYNTHETIC_STOP_INTENT_ONLY':raise CampaignHold('PAIR_STOP_NOT_COMMITTED')
            return {'action':'SYNTHETIC_STOP_ONLY','app':app,'productionAdmission':False}
        except BaseException:self._hold();raise
    def observe_stop(self,record,*,at,original_absent):
        try:self.campaign.observed('VERIFY_STOP',at=at,custody=self._custody(),record=record,original_absent=original_absent,current_start=None)
        except BaseException:self._hold();raise
    def rehearsal_candidate(self,*,at):
        try:return self.campaign.candidate('REHEARSAL',at=at,custody=self._custody())
        except BaseException:self._hold();raise
    def observe_rehearsal(self,*,at,no_real_effects):
        try:
            if no_real_effects is not True:raise CampaignHold('REHEARSAL_OUTCOME_UNKNOWN')
            self.campaign.observed('REHEARSAL_NO_REAL_EFFECTS_CONFIRMED',at=at,custody=self._custody())
        except BaseException:self._hold();raise
    def return_candidate(self,app,*,at):
        try:
            self.campaign.candidate('START_PENDING',app,at=at,custody=self._custody())
            result=self.pair.connected_start_intent(app)
            if result!='SYNTHETIC_CONNECTED_START_INTENT_ONLY':raise CampaignHold('PAIR_RETURN_NOT_COMMITTED')
            return {'action':'SYNTHETIC_START_ONLY','app':app,'productionAdmission':False}
        except BaseException:self._hold();raise
    def observe_return(self,record,*,at,start):
        try:
            self.campaign.observed('VERIFY_START',at=at,custody=self._custody(),record=record,current_start=start)
            if type(start) is not str or not start.isascii() or not start.isdigit():raise CampaignHold('RETURN_START_INVALID')
            self.return_starts[record['id']]=int(start)
        except BaseException:self._hold();raise
    def begin_stability(self,http,api,wa,*,at):
        try:
            self.campaign.candidate('OBSERVE_STABILITY',at=at,custody=self._custody())
            # Bind the actual pure Stability signatures to the return observations,
            # not to an unrelated good synthetic baseline selected by a caller.
            for i,health in ((0,api),(1,wa)):
                r=self.campaign.running[i]
                if (health.pid,health.start,health.restarts,health.pm_uptime)!=(r['pid'],self.return_starts[i],r['restart_time'],r['pm_uptime']):raise CampaignHold('STABILITY_RECORD_MISMATCH')
            self.observer=Stability(http,api,wa)
        except BaseException:self._hold();raise
    def stability_sample(self,at,api,wa,http,*,listener_owned,wa_connected):
        try:
            if self.observer is None:raise CampaignHold('NO_STABILITY_OBSERVER')
            custody=self._custody();self.campaign._guard(at,custody)
            result=self.observer.sample(at,api,wa,http,api_listener_owned=listener_owned,wa_connection_confirmed=wa_connected)
            if result.startswith('HOLD_'):raise CampaignHold('STABILITY_FAILED')
            if result=='OPERATIONAL_EQUIVALENCE_SAMPLED':self.campaign.observed(result,at=at,custody=custody)
            return result
        except BaseException:self._hold();raise
    def verify_exit(self,*,at,reconciled):
        try:
            if reconciled is not True:raise CampaignHold('EXTERNAL_EFFECTS_UNRECONCILED')
            self.campaign.candidate('VERIFY_EXIT',at=at,custody=self._custody())
            self.campaign.observed('OWNED_EFFECTS_RECONCILED_EXIT_VERIFIED',at=at,custody=self._custody())
            return self.campaign.snapshot()
        except BaseException:self._hold();raise
