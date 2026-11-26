// Local, bounded diagnostic counters. No media metadata, identifiers, or network.
const HISTORY = 96;
const STAGES = ['demuxMs', 'decodeMs', 'convertMs', 'copyMs', 'scaleMs', 'readMs'];
const positive = n => Number.isFinite(n) && n >= 0;
const rounded = n => Math.round(n * 1000) / 1000;
const integer = n => positive(n) ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n)) : null;
const stat = () => ({count:0, total:0, min:Infinity, max:0});
function add(s, n) {
  if (!positive(n)) return;
  s.count++;
  s.total += n;
  s.min = Math.min(s.min, n);
  s.max = Math.max(s.max, n);
}
function summary(s) {
  return {count:s.count, total:rounded(s.total), min:s.count ? rounded(s.min) : null,
    max:s.count ? rounded(s.max) : null, mean:s.count ? rounded(s.total/s.count) : null};
}
function ring() {
  const items = [];
  let cursor = 0;
  return {
    add(value) { items[cursor++ % HISTORY] = value; },
    snapshot() {
      const end = cursor % HISTORY;
      return cursor <= HISTORY ? items.slice() : [...items.slice(end), ...items.slice(0,end)];
    }
  };
}
export function createPlaybackDiagnostics({threads,width,shader,mirror} = {}, now = () => performance.now()) {
  const start = now();
  const time = () => Math.max(0, now()-start);
  let shaderActive = null, sourceFPS = null, batches = 0, decodedPairs = 0, presentedPairs = 0;
  let lastFrame = null, lastPresent = null, bufferingSince = null;
  let desktopFrames = 0, xrFrames = 0, lastXR = null, firstPresentMs = null;
  const worker = stat(), roundTrip = stat(), overhead = stat(), drawGap = stat();
  const presentationGap = stat(), display = stat(), buffered = stat(), stalls = stat();
  const workerStages = Object.fromEntries(STAGES.map(key => [key,stat()]));
  const recentBatches = ring(), recentStalls = ring(), recentLongGaps = ring();

  return {
    actualShader(active) { shaderActive = Boolean(active); },
    source(fps) { sourceFPS = Number.isFinite(fps) && fps > 0 ? rounded(fps) : null; },
    batch({requested,pairs,workerMs,roundTripMs,stages,queue} = {}) {
      batches++;
      decodedPairs += integer(pairs) ?? 0;
      add(worker,workerMs);
      add(roundTrip,roundTripMs);
      if (positive(workerMs) && positive(roundTripMs)) add(overhead,Math.max(0,roundTripMs-workerMs));
      const stageValues = {};
      for (const key of STAGES) if (positive(stages?.[key])) {
        add(workerStages[key],stages[key]);
        stageValues[key] = rounded(stages[key]);
      }
      recentBatches.add({atMs:rounded(time()), requested:integer(requested), pairs:integer(pairs),
        workerMs:positive(workerMs) ? rounded(workerMs) : null,
        roundTripMs:positive(roundTripMs) ? rounded(roundTripMs) : null,
        queue:integer(queue), stages:Object.keys(stageValues).length ? stageValues : undefined});
    },
    frame({queue,xr} = {}) {
      const t = time(), inXR = Boolean(xr);
      if (inXR) xrFrames++; else desktopFrames++;
      if (lastFrame !== null && lastXR === inXR) {
        const gap = t-lastFrame;
        add(drawGap,gap);
        if (gap >= 24) recentLongGaps.add({atMs:rounded(t),gapMs:rounded(gap),queue:integer(queue),xr:inXR});
      }
      lastFrame = t;
      lastXR = inXR;
      if (presentedPairs) add(buffered,integer(queue) ?? NaN);
    },
    present({costMs,queue} = {}) {
      const t = time();
      presentedPairs++;
      if (firstPresentMs === null) firstPresentMs=t;
      add(display,costMs);
      add(buffered,integer(queue) ?? NaN);
      if (lastPresent !== null) add(presentationGap,t-lastPresent);
      lastPresent=t;
    },
    stall(active) {
      const t = time();
      if (active && bufferingSince === null) bufferingSince=t;
      if (!active && bufferingSince !== null) {
        const duration = t-bufferingSince;
        add(stalls,duration);
        recentStalls.add({atMs:rounded(bufferingSince),durationMs:rounded(duration)});
        bufferingSince=null;
      }
    },
    // Call on manual pause/resume or visibility change, so those gaps do not
    // look like presentation jitter. Call stall(false) separately if needed.
    resetCadence() { lastFrame=lastPresent=lastXR=null; },
    snapshot() {
      const elapsed = time();
      const stageSummary = Object.fromEntries(STAGES.filter(key => workerStages[key].count)
        .map(key => [key,summary(workerStages[key])]));
      return {schemaVersion:1, captures:'spatial-video-lab',
        configuration:{threads:integer(threads), outputWidth:integer(width), shader:Boolean(shader), shaderActive, mirror:Boolean(mirror)},
        elapsedMs:rounded(elapsed), sourceFPS, decodedPairs, presentedPairs,
        firstPresentMs:firstPresentMs === null ? null : rounded(firstPresentMs),
        worker:{batches, workMs:summary(worker), roundTripMs:summary(roundTrip),
          turnaroundOverheadMs:summary(overhead), stages:stageSummary,
          workPairsPerSecond:worker.total ? rounded(1000*decodedPairs/worker.total) : null,
          roundTripPairsPerSecond:roundTrip.total ? rounded(1000*decodedPairs/roundTrip.total) : null,
          recentBatches:recentBatches.snapshot()},
        playback:{queuePairs:summary(buffered), completedStallMs:summary(stalls),
          activeStallMs:bufferingSince === null ? null : rounded(elapsed-bufferingSince),
          bufferStallCount:stalls.count + Number(bufferingSince !== null),
          recentStalls:recentStalls.snapshot()},
        render:{desktopFrames,xrFrames, callbackGapMs:summary(drawGap), presentGapMs:summary(presentationGap),
          displaySubmitMs:summary(display), recentLongGaps:recentLongGaps.snapshot()}};
    }
  };
}

export function downloadPlaybackDiagnostics(diagnostics, {
  document:doc = globalThis.document, URL:urlAPI = globalThis.URL,
  setTimeout:schedule = globalThis.setTimeout
} = {}) {
  const blob = new Blob([JSON.stringify(diagnostics.snapshot(),null,2)+'\n'],{type:'application/json'});
  const url = urlAPI.createObjectURL(blob);
  const link = doc.createElement('a');
  try {
    link.href=url;
    link.download='spatial-playback-diagnostics.json';
    doc.body.append(link);
    link.click();
  } finally {
    link.remove();
    schedule(() => urlAPI.revokeObjectURL(url), 1000);
  }
}
