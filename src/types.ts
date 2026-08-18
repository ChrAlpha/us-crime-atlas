export type Coordinates = readonly [longitude: number, latitude: number];
export type CrimeCategory = 'homicide'|'sexual'|'robbery'|'assault'|'burglary'|'theft'|'vehicle'|'weapons'|'other';
export type CrimeGroup = 'violent'|'property'|'vehicle'|'weapons'|'other';
export type LocationPrecision = 'exact'|'block'|'intersection'|'approximate';
export interface Incident {
  id:string; providerId:string; occurredAt:string; occurredAtEpochMs:number; localHour:number|null;
  category:CrimeCategory; group:CrimeGroup; rawCategory:string; description:string; locationLabel:string;
  coordinates:Coordinates; severity:number; isViolent:boolean; precision:LocationPrecision;
}
export interface CoverageBounds { west:number; south:number; east:number; north:number; }
export interface ProviderMeta {
  id:string; city:string; state:string; label:string; agency:string; datasetName:string; endpoint:string; sourceUrl:string;
  center:Coordinates; zoom:number; bounds:CoverageBounds; cadence:string; delayNote:string; precision:LocationPrecision;
  precisionNote:string; coverageNote:string; lastVerified:string;
}
export interface IncidentQuery { center:Coordinates; radiusMeters:number; windowDays:number; now:Date; signal?:AbortSignal; }
export interface IncidentBatch { incidents:Incident[]; provider:ProviderMeta; fetchedAt:string; queryLimit:number; truncated:boolean; requestUrl:string; }
export interface IncidentProvider { meta:ProviderMeta; fetchIncidents(query:IncidentQuery):Promise<IncidentBatch>; }
export interface SelectedPlace { label:string; detail:string; coordinates:Coordinates; }
export type EvidenceBand = 'lower'|'similar'|'elevated'|'markedly-elevated'|'insufficient';
export type EvidenceConfidence = 'low'|'medium'|'high';
export interface CategoryBreakdownItem { category:CrimeCategory; count:number; share:number; }
export interface DailyActivity { date:string; count:number; }
export interface AnalysisResult {
  currentIncidents:Incident[]; previousIncidents:Incident[]; nearbyCurrentIncidents:Incident[]; mapIncidents:Incident[];
  currentCount:number; previousCount:number; violentCount:number; nightCount:number; violentShare:number; nightShare:number;
  trendPercent:number|null; trendDirection:'up'|'down'|'flat'|'new'|'none'; innerWeightedDensity:number;
  nearbyWeightedDensity:number; relativeActivity:number|null; band:EvidenceBand; confidence:EvidenceConfidence;
  categoryBreakdown:CategoryBreakdownItem[]; dailyActivity:DailyActivity[]; latestObservedAt:string|null;
}
export interface AtlasState { place:SelectedPlace; radiusMeters:number; windowDays:number; activeGroups:CrimeGroup[]; }
