'use strict';
/* ====================================================================
   Events & boot
   ==================================================================== */
function classify(file) {
  const n = (file.name || '').toLowerCase(), t = file.type || '';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (t.startsWith('audio/') || /\.(mp3|wav|wave|m4a|aac|aif|aiff|flac|ogg|oga|opus|caf|wma|mp4|mov)$/.test(n)) return 'audio';
  return null;
}
async function handleFiles(files) {
  const list = Array.from(files || []); let pdf = null, audio = null;
  list.forEach(f => { const k = classify(f); if (k === 'pdf' && !pdf) pdf = f; else if (k === 'audio' && !audio) audio = f; });
  if (!pdf && !audio) { toast(tx('app.badfile')); return; }
  if (pdf) await loadPdf(pdf);
  if (audio) await loadAudio(audio);
}
/* ====================================================================
   Removing files, tap-out mode, settings menu, export warning, full screen
   ==================================================================== */
function removeAudio() {
  if (!S.audio) return;
  Transport.pause();
  S.manualDur = Math.max(S.manualDur || 0, S.audio.duration);   // the timeline keeps its length, so no turn moves
  S.audio = null; vqNote(); S.time = clamp(S.time, S.vStart, vEnd()); if (DISK.meta) DISK.remove().catch(() => {});
  setChips(); layoutTimeline(); TL.staticDirty = true; stageDirty = true; updateButtons(); updateInfo(); updateTimeUI(true);
  toast(tx('aud.removed'));
}
function removePdf() {
  if (!S.pdf) return;
  Transport.pause();
  if (S.turnsEdited && S.turns.length) S.savedTurns = { turns: S.turns.slice(), edited: true, ph: S.ph.slice() };          // turns you never moved do not replace ones saved earlier
  S.manualDur = Math.max(S.manualDur || 0, vEnd());
  try { S.pdf.doc.destroy(); } catch (e) {}
  loadToken++;                                                   // stops thumbnail generation
  S.pdf = null; pdfCachesReset(); S.pendingPages = null; S.pendingWm = null; S.pendingSize = null; S.spreads = []; S.turns = []; S.ph = []; S.thumbs = []; S.time = S.vStart; S.history = []; S.redo = []; updateHistoryButtons();
  if (previewR) previewR.clearTextures();
  $('#empty').hidden = false;
  setChips(); layoutTimeline(); TL.staticDirty = true; stageDirty = true; updateButtons(); updateInfo(); updateTimeUI(true); updateHint();
  if (FS.on) exitFull();
  toast(tx(S.savedTurns ? 'pdf.removedkeep' : 'pdf.removed'));
}
function adoptPriorTurns(prior, quiet) {
  if (!prior || !prior.edited || !prior.turns.length || S.spreads.length < 2) return null;
  const need = S.spreads.length - 1, keep = Math.min(need, prior.turns.length), dur = vEnd();
  const turns = prior.turns.slice(0, keep), ph = (prior.ph || []).slice(0, keep);
  while (ph.length < keep) ph.push(false);
  const added = need - keep;
  if (added > 0) { const b = turns.length ? turns[turns.length - 1] : 0; for (let k = 1; k <= added; k++) { turns.push(b + (dur - b) * k / (added + 1)); ph.push(true); } }
  S.turns = turns; S.ph = ph; S.turnsEdited = true; normalizeTurns(); onTurnsChanged();
  const dropped = Math.max(0, prior.turns.length - need);
  if (!quiet) toast([tx('turns.kept'), added ? tx(added === 1 ? 'turns.added.one' : 'turns.added.many', { n: added }) : '', dropped ? tx(dropped === 1 ? 'turns.dropped.one' : 'turns.dropped.many', { n: dropped }) : ''].filter(Boolean).join(' '), 8000);
  return { added, dropped };
}

const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

