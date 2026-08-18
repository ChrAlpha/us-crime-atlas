export function sourceTimestampToEpoch(value:string){if(!value)return Number.NaN; const normalized=/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:`${value}Z`; return Date.parse(normalized);}
export function combineDateAndTime(dateValue:string,timeValue?:string){const date=dateValue.slice(0,10); const time=timeValue&&/^\d{2}:\d{2}/.test(timeValue)?timeValue.slice(0,8):'00:00:00'; return `${date}T${time}`;}
export function hourFromTimestamp(value:string):number|null{const match=value.match(/T(\d{2}):/); if(!match?.[1])return null; const hour=Number(match[1]); return Number.isInteger(hour)&&hour>=0&&hour<=23?hour:null;}
export function formatSourceTimestamp(value:string){const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if(!match)return value; const [,year,month,day,hour,minute]=match; return `${month}/${day}/${year} · ${hour}:${minute}`;}
export function isoDate(epochMs:number){return new Date(epochMs).toISOString().slice(0,10);}
