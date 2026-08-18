import type { CrimeCategory, CrimeGroup } from '../types';
const violentCategories = new Set<CrimeCategory>(['homicide','sexual','robbery','assault']);
export const CATEGORY_LABELS:Record<CrimeCategory,string>={homicide:'Homicide',sexual:'Sexual offense',robbery:'Robbery',assault:'Assault',burglary:'Burglary',theft:'Theft',vehicle:'Vehicle theft',weapons:'Weapons',other:'Other'};
export const GROUP_LABELS:Record<CrimeGroup,string>={violent:'Violent',property:'Property',vehicle:'Vehicle',weapons:'Weapons',other:'Other'};
export const CATEGORY_SEVERITY:Record<CrimeCategory,number>={homicide:5,sexual:4.5,robbery:4,assault:3.7,weapons:3.4,burglary:2.5,vehicle:2.1,theft:1.3,other:1};
const patterns:Array<[RegExp,CrimeCategory]>=[
  [/(homicide|murder|manslaughter|negligent killing)/i,'homicide'],
  [/(rape|sexual|sex abuse|indecent|sodomy)/i,'sexual'],
  [/(robbery|carjacking)/i,'robbery'],
  [/(assault|battery|aggravated|simple assault)/i,'assault'],
  [/(burglary|breaking[ -]?and[ -]?entering|residential break)/i,'burglary'],
  [/(motor vehicle (?:theft|larceny)|vehicle theft|auto theft|grand larceny.*(?:auto|motor vehicle)|stolen vehicle)/i,'vehicle'],
  [/(weapon|firearm|gun offense)/i,'weapons'],
  [/(theft|larceny|shoplifting|stolen property|pickpocket|purse snatch)/i,'theft'],
];
export function normalizeCategory(value:string):CrimeCategory { const normalized=value.trim(); for(const [pattern,category] of patterns){if(pattern.test(normalized))return category;} return 'other'; }
export function categoryGroup(category:CrimeCategory):CrimeGroup { if(violentCategories.has(category))return 'violent'; if(category==='burglary'||category==='theft')return 'property'; if(category==='vehicle')return 'vehicle'; if(category==='weapons')return 'weapons'; return 'other'; }
export function isViolentCategory(category:CrimeCategory){return violentCategories.has(category);}
export function severityForCategory(category:CrimeCategory){return CATEGORY_SEVERITY[category];}
