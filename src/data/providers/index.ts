import { pointIsWithinBounds } from '../../domain/geo';
import type { Coordinates,IncidentProvider,ProviderMeta,SelectedPlace } from '../../types';
import { chicagoProvider,CHICAGO_META } from './chicago';import { newYorkProvider,NEW_YORK_META } from './newYork';import { sanFranciscoProvider,SAN_FRANCISCO_META } from './sanFrancisco';
export const providers:IncidentProvider[]=[newYorkProvider,chicagoProvider,sanFranciscoProvider];export const providerMetadata:ProviderMeta[]=providers.map(p=>p.meta);
export function findProviderForPoint(point:Coordinates){return providers.find(p=>pointIsWithinBounds(point,p.meta.bounds))??null;}
export const FEATURED_PLACES:SelectedPlace[]=[{label:'Times Square',detail:'Manhattan · New York City',coordinates:[-73.9855,40.758]},{label:'Lower Manhattan',detail:'New York City',coordinates:[-74.0089,40.7105]},{label:'The Loop',detail:'Chicago, Illinois',coordinates:[-87.6298,41.8837]},{label:'Union Square',detail:'San Francisco, California',coordinates:[-122.4075,37.788]}];
export const PROVIDER_CENTERS:Record<string,SelectedPlace>={[NEW_YORK_META.id]:FEATURED_PLACES[0]!,[CHICAGO_META.id]:FEATURED_PLACES[2]!,[SAN_FRANCISCO_META.id]:FEATURED_PLACES[3]!};
