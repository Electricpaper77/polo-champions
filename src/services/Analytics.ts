type EventName="Game_Loaded"|"Match_Started"|"Match_Completed"|"Low_Performance_Detected";
export function track(event:EventName,metadata:Record<string,number|string|boolean>={}){const payload=JSON.stringify({event,metadata,timestamp:Date.now()});try{navigator.sendBeacon?.("/api/analytics",payload)}catch{/* Analytics must never affect play. */}}
