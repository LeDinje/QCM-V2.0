import { auth, db, collection, doc, getDocs, addDoc, ensureAnonAuth, serverTimestamp } from "./common.js";

// --- Elements ---
var DEBUG_TRUST = /[?&]debug=1\b/.test(location.search);
var els = {
  select: document.getElementById("quizSelect"),
  name: document.getElementById("candidateName"),
  startBtn: document.getElementById("startBtn"),
  quizMeta: document.getElementById("quizMeta"),
  quizTitle: document.getElementById("quizTitle"),
  timer: document.getElementById("timer"),
  cardSelect: document.getElementById("card-select"),
  cardQuiz: document.getElementById("card-quiz"),
  cardResults: document.getElementById("card-results"),
  questionBox: document.getElementById("questionBox"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  scoreText: document.getElementById("scoreText"),
};

// === Easter egg : nom d'exemple aleatoire (figures connues de l'informatique), change a chaque F5 ===
(function setRandomNamePlaceholder(){
  try {
    var famousNames = [
      "Jane Doe",
      "Ada Lovelace", "Alan Turing", "Grace Hopper", "Linus Torvalds",
      "Dennis Ritchie", "Ken Thompson", "Tim Berners-Lee", "Margaret Hamilton",
      "Donald Knuth", "Guido van Rossum", "Brian Kernighan", "Vint Cerf",
      "Edsger Dijkstra", "Claude Shannon", "Bjarne Stroustrup", "James Gosling",
      "Richard Stallman", "Steve Wozniak", "Katherine Johnson", "Radia Perlman",
      "Barbara Liskov", "John von Neumann", "Hedy Lamarr", "Anita Borg", "Larry Wall"
    ];
    if (els.name) {
      var pick = famousNames[Math.floor(Math.random() * famousNames.length)];
      els.name.placeholder = "Ex : " + pick;
    }
  } catch (e) {}
})();

// --- State ---
var state = {
  otherText: {},
quizId: null,
  quizTitle: "",
  timerMinutes: 0,
  questions: [], // {id,text,options[],correctIndex}
  idx: 0,
  chosen: {}, // qid -> selected index
  endAt: 0,
  tick: null,
  antiCheatArmed: false,
  finished: false, // verrou: empeche d'enregistrer 2 fois le resultat

  // Trust/anti-cheat replacement state
  trust: { events: [], lostCount: 0, totalOutMs: 0 },
  trackingEnabled: false,
  isOff:false, offStart:0, offQid:null, currentQid:null,
  focusStats: {}
};

// --- Trust-factor safe wrappers ---
const __tf = {
  beginOff: function(reason){ 
    if (typeof tf_beginOff === 'function') { return tf_beginOff.apply(null, arguments); }
    // Fallback logic: start counting if not already off
    if (DEBUG_TRUST) console.warn('[trust] beginOff shim used');
    try{
      if (!state.trackingEnabled) return;
      if (state.isOff) return;
      state.isOff = true;
      state.offStart = Date.now();
      var q = state.questions[state.idx];
      state.offQid = q ? q.id : null;
    }catch(e){}
  },
  endOff: function(reason){
    if (typeof tf_endOff === 'function') { return tf_endOff.apply(null, arguments); }
    // Fallback logic: stop counting and record event
    if (DEBUG_TRUST) console.warn('[trust] endOff shim used');
    try{
      if (!state.trackingEnabled) return;
      if (!state.isOff) return;
      state.isOff = false;
      var dur = Date.now() - state.offStart;
      if (dur <= 800) return; // ignore tiny flickers
      var penalized = dur - 2000; // franchise 2s
      if (penalized < 0) penalized = 0;
      var ev = { t: Date.now(), ms: penalized, qid: state.offQid || null };
      if (!state.trust) state.trust = { events: [], lostCount: 0, totalOutMs: 0 };
      state.trust.events.push(ev);
      state.trust.lostCount += 1;
      state.trust.totalOutMs += penalized;
      if (ev.qid){
        if (!state.focusStats) state.focusStats = {};
        if (!state.focusStats[ev.qid]) state.focusStats[ev.qid] = { losses:0, ms:0 };
        state.focusStats[ev.qid].losses += 1;
        state.focusStats[ev.qid].ms += penalized;
      }
    }catch(e){}
  },
  computeScore: function(){
    if (typeof tf_computeScore === 'function') { return tf_computeScore.apply(null, arguments); }
    if (DEBUG_TRUST) console.warn('[trust] computeScore shim used');
    try{
      var lc = (state.trust && state.trust.lostCount) || 0;
      var ms = (state.trust && state.trust.totalOutMs) || 0;
      var s = 100 - (lc*10) - Math.floor(ms/1000);
      if (s < 0) s = 0; if (s > 100) s = 100;
      return s;
    }catch(e){ return 100; }
  }
};
// --- End wrappers ---



function shuffle(arr){
  var a = arr.slice();
  for (var i=a.length-1;i>0;i--){
    var j = Math.floor(Math.random()*(i+1));
    var t = a[i]; a[i]=a[j]; a[j]=t;
  }
  

// === Silent Trust-Factor (focus tracking) ===
// We record blur/visibilitychange periods without ending the test.
// Rules: ignore short leaves (<800ms). Deduct a 2s "franchise" per event.
function tf_beginOff(reason){ if (DEBUG_TRUST) console.log('[trust] beginOff', reason, 'qid=', state.currentQid);
  if (!state.trackingEnabled) return;
  if (state.isOff) return;
  if (!state.trackingEnabled || state.isOff) return;
  state.isOff = true;
  state.offStart = Date.now();
  var q = state.questions[state.idx];
  state.offQid = q ? q.id : null;
}
function tf_endOff(reason){ if (DEBUG_TRUST) console.log('[trust] endOff', reason, 'qid=', state.offQid, 'dur(ms)=', Date.now()-state.offStart);
  if (!state.trackingEnabled) return;
  if (!state.isOff) return;
  if (!state.trackingEnabled || !state.isOff) return;
  state.isOff = false;
  var dur = Date.now() - state.offStart;
  if (dur <= 800) return; // ignore tiny flickers
  var penalized = dur - 2000; // franchise 2s
  if (penalized < 0) penalized = 0;
  var ev = { t: Date.now(), ms: penalized, qid: state.offQid || null };
  state.trust.events.push(ev);
  state.trust.lostCount += 1;
  state.trust.totalOutMs += penalized;

  if (ev.qid){
    if (!state.focusStats[ev.qid]) state.focusStats[ev.qid] = { losses:0, ms:0 };
    state.focusStats[ev.qid].losses += 1;
    state.focusStats[ev.qid].ms += penalized;
  }
}
function tf_computeScore(){
  // Simple scoring: -10 points per loss, and -1 point per full second out-of-window (after franchise), min 0.
  var s = 100 - (state.trust.lostCount * 10) - Math.floor(state.trust.totalOutMs / 1000);
  if (s < 0) s = 0;
  if (s > 100) s = 100;
  return s;
}

return a;
}

// --- Load quizzes into the <select> ---
function loadQuizzes(){
  return getDocs(collection(db, "quizzes")).then(function(snap){
    var opts = [];
    snap.forEach(function(d){
      var q = d.data() || {};
      opts.push({
        id: d.id,
        title: q.title || "Sans titre",
        timer: Number(q.timerMinutes || 0),
        desc: q.description || "",
        orderIndex: (typeof q.orderIndex === "number") ? q.orderIndex : null
      });
    });
    // meme ordre personnalise que l'admin (orderIndex), sinon par titre
    opts.sort(function(a,b){
      var ao = (typeof a.orderIndex === "number") ? a.orderIndex : 1e9;
      var bo = (typeof b.orderIndex === "number") ? b.orderIndex : 1e9;
      if (ao !== bo) return ao - bo;
      return String(a.title).localeCompare(String(b.title));
    });
    var esc = function(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); };
    var html = '<option value="">— Sélectionner un QCM —</option>';
    for (var k=0;k<opts.length;k++){
      var o = opts[k];
      var t = esc(o.title);
      html += '<option value="'+o.id+'" data-timer="'+o.timer+'" data-title="'+t+'">'+t+'</option>';
    }
    if (els.select){ els.select.innerHTML = html; }
    if (els.select){
      els.select.addEventListener("change", function(){
        var si = els.select.selectedIndex;
        var opt = si >= 0 ? els.select.options[si] : null;
        var t = opt ? Number(opt.getAttribute("data-timer")||"0") : 0;
        var title = opt ? opt.getAttribute("data-title") || "" : "";
        state.timerMinutes = t;
        state.quizTitle = title;
        if (els.quizMeta){
          els.quizMeta.textContent = (t>0 ? ("⏱ Chronométré : "+t+" min") : "Non chronométré");
        }
      }, { once: true });
    }
  }).catch(function(e){
    console.error("[loadQuizzes] error:", e);
  });
}

// --- Load questions for a quiz ---
function loadQuestions(quizId){
  return getDocs(collection(db, "quizzes", quizId, "questions")).then(function(sap){
    var arr = [];
    sap.forEach(function(d){
      var q = d.data() || {};
      var options = Array.isArray(q.options) ? q.options.slice() : (Array.isArray(q.answers) ? q.answers.slice() : []);
      var text = q.text || q.title || q.question || "(sans intitulé)";
      var correctIndex = (typeof q.correctIndex === "number") ? q.correctIndex : -1;
      // shuffle options but preserve which index is correct
      var map = shuffle(options.map(function(v,i){ return { v:v, i:i }; }));
      var newOptions = map.map(function(x){ return x.v; });
      var newCorrect = -1;
      for (var m=0;m<map.length;m++){ if (map[m].i === correctIndex){ newCorrect = m; break; } }
      var createdAtMs = 0;
    try { if (q.createdAt && typeof q.createdAt.seconds === 'number') { createdAtMs = q.createdAt.seconds*1000 + (q.createdAt.nanoseconds||0)/1e6; } } catch(e){}
    var orderIndex = (typeof q.orderIndex === 'number') ? q.orderIndex : (typeof q.order === 'number' ? q.order : null);
    arr.push({ id: d.id, text: text, options: newOptions, correctIndex: newCorrect, orderIndex: orderIndex, createdAtMs: createdAtMs, imageUrl: (q.imageUrl || q.imageURL || q.imgUrl || q.image || q.image_url || null) });
    });
    // Sort questions by orderIndex asc, then createdAt asc (fallback)
    arr.sort(function(a,b){
      var ao = (typeof a.orderIndex === 'number') ? a.orderIndex : 1e9;
      var bo = (typeof b.orderIndex === 'number') ? b.orderIndex : 1e9;
      if (ao !== bo) return ao - bo;
      var ac = (typeof a.createdAtMs === 'number') ? a.createdAtMs : 0;
      var bc = (typeof b.createdAtMs === 'number') ? b.createdAtMs : 0;
      return ac - bc;
    });
    state.questions = arr; state.idx = 0; state.chosen = {};
  }).catch(function(e){
    console.error("[loadQuestions] error:", e);
    state.questions = [];
  });
}

// --- Render current question ---
function renderQuestion(){
  state.currentQid = (state.questions[state.idx] && state.questions[state.idx].id) || null;
  if (!state.trackingEnabled) { state.trackingEnabled = true; if (DEBUG_TRUST) console.log('[trust] tracking enabled (render)'); }
  var q = state.questions[state.idx];
  if (!q) return;
  if (els.quizTitle) els.quizTitle.textContent = state.quizTitle || "";
  var chosen = state.chosen[q.id];
  var otherVal = (state.otherText && state.otherText[q.id]) ? state.otherText[q.id] : "";

  var optionsHtml = "";
  for (var i=0;i<q.options.length;i++){
    var opt = q.options[i];
    if (opt === 'Autres') {
      var checkedOther = (chosen === 'other') ? ' checked' : '';
      var show = (chosen === 'other') ? 'block' : 'none';
      optionsHtml += ''
        + '<label class="item" style="flex-direction:column;align-items:flex-start">'
        +   '<div>'
        +     '<input type="radio" name="opt" value="other"'+checkedOther+'> Autres'
        +   '</div>'
        +   '<div style="margin-top:8px;width:100%;display:'+show+'">'
        +     '<textarea class="other-input" placeholder="Votre réponse..." style="width:100%;min-height:110px;font-size:14px;line-height:1.6;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid #2b3445;background:#0b1220;color:#e5e7eb;font-family:inherit">'+(otherVal||'')+'</textarea>'
        +   '</div>'
        + '</label>';
    } else {
      var checked = (chosen === i) ? ' checked' : '';
      optionsHtml += '<label class="item"><div><input type="radio" name="opt" value="'+i+'"'+checked+'> '+opt+'</div></label>';
    }
  }

  if (els.questionBox){
    els.questionBox.innerHTML = ''
      + '<div class="small muted">Question '+(state.idx+1)+' / '+state.questions.length+'</div>'
      + (q.imageUrl ? '<div style="margin:10px 0;text-align:center">'
        + '<div style="position:relative;display:inline-block">'
        + '<img id="qimg" src="'+q.imageUrl+'" onerror="this.style.display=\'none\';document.getElementById(\'imgErrHint\')&& (document.getElementById(\'imgErrHint\').style.display=\'block\');" '
        + 'style="max-width:100%;max-height:280px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);background:#1f2937;padding:4px;cursor:zoom-in" '
        + 'title="Cliquer pour agrandir">'
        + '<span style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.6);border-radius:6px;padding:2px 7px;font-size:11px;color:#e5e7eb;pointer-events:none">🔍 Agrandir</span>'
        + '</div>'
        + '<div id="imgErrHint" class="small" style="display:none;color:#b91c1c;margin-top:6px">Image non chargeable (URL invalide ou droits Storage)</div>'
        + '<div id="img-zoom-overlay" style="display:none;position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.88);align-items:center;justify-content:center;flex-direction:column">'
        + '  <div style="position:relative;max-width:96vw;max-height:92vh">'
        + '    <img id="img-zoom-large" src="'+q.imageUrl+'" style="max-width:94vw;max-height:88vh;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.6);background:#1f2937;padding:6px">'
        + '    <button id="img-zoom-close" type="button" style="position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:20px;line-height:1;cursor:pointer">&times;</button>'
        + '  </div>'
        + '  <p style="color:#9ca3af;font-size:13px;margin-top:12px">Cliquez en dehors de l\'image ou sur &times; pour fermer</p>'
        + '</div>'
      + '</div>' : '')
      + '<div style="font-weight:700;margin:6px 0 10px 0">'+q.text+'</div>'
      + '<div class="list">'+optionsHtml+'</div>';

    // Wire image zoom — stays in-page so no focus/visibility event is triggered
    var qimg = els.questionBox.querySelector('#qimg');
    var overlay = els.questionBox.querySelector('#img-zoom-overlay');
    var zoomClose = els.questionBox.querySelector('#img-zoom-close');
    if (qimg && overlay) {
      qimg.addEventListener('click', function() {
        overlay.style.display = 'flex';
      });
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.style.display = 'none';
      });
      if (zoomClose) zoomClose.addEventListener('click', function(e) {
        e.stopPropagation();
        overlay.style.display = 'none';
      });
    }

    // bind radios + textarea
    var radios = els.questionBox.querySelectorAll('input[name="opt"]');
    for (var r=0;r<radios.length;r++){
      radios[r].addEventListener('change', function(ev){
        var val = ev.target.value;
        if (val === 'other') {
          state.chosen[q.id] = 'other';
          // show textarea
          var wrap = ev.target.closest('label');
          if (wrap){
            var box = wrap.querySelector('.other-input');
            var div = box ? box.parentElement : null;
            if (div) div.style.display = 'block';
            if (box) box.focus();
            // hide other textareas in other labels
            var all = els.questionBox.querySelectorAll('.other-input');
            for (var k=0;k<all.length;k++){
              if (all[k] !== box) {
                all[k].parentElement.style.display = 'none';
              }
            }
          }
        } else {
          state.chosen[q.id] = Number(val);
          // hide any other textarea
          var all2 = els.questionBox.querySelectorAll('.other-input');
          for (var k2=0;k2<all2.length;k2++){
            all2[k2].parentElement.style.display = 'none';
          }
        }
      });
    }

    var ta = els.questionBox.querySelector('.other-input');
    if (ta){
      ta.addEventListener('input', function(){
        if (!state.otherText) state.otherText = {};
        state.otherText[q.id] = ta.value;
      });
    }
  }

  // update progress
  updateNav();
}

// --- Timer ---
function startTimer(){
  if (!els.timer) return;
  if (!state.timerMinutes || state.timerMinutes<=0){ els.timer.textContent = ""; return; }
  var totalMs = state.timerMinutes * 60 * 1000;
  state.endAt = Date.now() + totalMs;
  if (state.tick) clearInterval(state.tick);
  state.tick = setInterval(function(){
    var left = state.endAt - Date.now();
    if (left <= 0){
      clearInterval(state.tick);
      els.timer.textContent = "Temps écoulé";
      finish();
      return;
    }
    var sec = Math.floor(left/1000);
    var m = Math.floor(sec/60);
    var s = sec % 60;
    els.timer.textContent = '⏱ '+m+':'+String(s).padStart(2,'0');
  }, 200);
}

// --- Helpers ---
function hideStartArea(){
  if (els.cardSelect) els.cardSelect.style.display = "none";
  var container = null;
  if (els.startBtn && typeof els.startBtn.closest === "function"){
    container = els.startBtn.closest('section, .card, .panel, .box, .container, .content, .paper, form');
  }
  if (!container && els.select && typeof els.select.closest === "function"){
    container = els.select.closest('section, .card, .panel, .box, .container, .content, .paper, form');
  }
  if (container){ try{ container.style.display = "none"; }catch(e){} }
  if (!container){
    if (els.select) els.select.style.display = "none";
    if (els.name) els.name.style.display = "none";
    if (els.startBtn) els.startBtn.style.display = "none";
  }
}

// --- Prestart overlay ---
var _pf = null;
function showPrestart(){
  var hasTimer = !!state.timerMinutes && state.timerMinutes > 0;
  var timerLine = hasTimer ? ('Ce QCM est <b>chronométré</b> : <b>'+state.timerMinutes+' minute'+(state.timerMinutes>1?'s':'')+'</b>.')
                           : ('Ce QCM <b>n’est pas chronométré</b>.');
  var html = ''
    + '<div id="pf-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9999;display:flex;align-items:center;justify-content:center">'
    + '  <div style="max-width:720px;width:92%;background:#1b1b1b;color:#f5f5f5;border-radius:16px;padding:22px;box-shadow:0 18px 40px rgba(0,0,0,.6)">'
    + '    <h2 style="margin:0 0 10px 0">Avant de commencer</h2>'
    + '    <ul style="margin:0 0 14px 18px;line-height:1.6">'
    + '      <li>'+timerLine+'</li>'
    + '' + '      <li>Ne rechargez pas la page pendant le test.</li>'
    + '    </ul>'
    + '    <div style="display:flex;gap:10px;justify-content:flex-end">'
    + '      <button id="pf-cancel" type="button" style="padding:10px 14px;border-radius:12px;border:1px solid #3a3a3a;background:#2a2a2a;color:#ddd;cursor:pointer">Annuler</button>'
    + '      <button id="pf-start" type="button" style="padding:10px 14px;border-radius:12px;border:0;background:#0d6efd;color:#fff;cursor:pointer">Commencer le test</button>'
    + '    </div>'
    + '  </div>'
    + '</div>';
  _pf = document.createElement('div');
  _pf.innerHTML = html;
  document.body.appendChild(_pf);
  var onCancel = function(e){ e.preventDefault(); e.stopPropagation(); hidePrestart(); };
  var onStart = function(e){ e.preventDefault(); e.stopPropagation(); hidePrestart(); actuallyStartQuiz(); };
  _pf.querySelector('#pf-cancel').addEventListener('click', onCancel);
  _pf.querySelector('#pf-start').addEventListener('click', onStart);
}
function hidePrestart(){
  if (_pf && _pf.parentNode){ _pf.parentNode.removeChild(_pf); }
  _pf = null;
}

// Start AFTER confirmation
function actuallyStartQuiz(){
  loadQuestions(state.quizId).then(function(){
    if (!state.questions.length){ alert("Ce QCM ne contient aucune question."); return; }
    hideStartArea();
    if (els.cardQuiz) els.cardQuiz.style.display = "block";
    renderQuestion();
    startTimer();
    // Arm anti-cheat AFTER first render
    // anti-cheat removed (no-op)
  });
}

// --- Flow ---
function startQuiz(){
  var id = els.select ? els.select.value : "";
  var name = els.name ? String(els.name.value||"").trim() : "";
  if (!id || !name){ alert("Choisis un QCM et indique ton nom."); return; }
  state.quizId = id;
  var si = els.select ? els.select.selectedIndex : -1;
  var opt = (si>=0 && els.select) ? els.select.options[si] : null;
  state.quizTitle = opt ? (opt.getAttribute("data-title") || "") : state.quizTitle;
  state.timerMinutes = opt ? Number(opt.getAttribute("data-timer")||"0") : state.timerMinutes;
  // Show confirmation overlay
  showPrestart();
}

function nextOrFinish(){
  var q = state.questions[state.idx];
  if (!q){ return; }
  if (!(q.id in state.chosen)){
    if (els.questionBox){
      var warn = els.questionBox.querySelector('.q-warn');
      if (!warn){
        warn = document.createElement('div');
        warn.className = 'q-warn';
        warn.style.cssText = 'margin:8px 0;padding:8px 10px;border-radius:8px;background:#fff3cd;border:1px solid #ffecb5;color:#664d03;font-size:14px;';
        // insert after the question title if possible
        var firstDiv = els.questionBox.querySelector('div:nth-child(2)');
        if (firstDiv && firstDiv.parentNode === els.questionBox) {
          els.questionBox.insertBefore(warn, firstDiv.nextSibling);
        } else {
          els.questionBox.insertBefore(warn, els.questionBox.firstChild);
        }
      }
      warn.textContent = "Sélectionne une réponse avant de continuer.";
      try { clearTimeout(warn.__t); } catch(e){}
      warn.__t = setTimeout(function(){ if (warn && warn.parentNode) warn.parentNode.removeChild(warn); }, 1800);
    }
    return;
  }
  if (state.idx === state.questions.length - 1){
    state.antiCheatArmed = false;
    finish();
  } else {
    state.idx++;
    renderQuestion();
  }
}

function prev(){
  if (state.idx > 0){
    state.idx--;
    renderQuestion();
  }
}

// --- Finish & save ---
function finish(endedBy){
  // verrou anti double-enregistrement (ex: chrono qui se declenche apres une fin manuelle)
  if (state.finished) return;
  state.finished = true;
  // stoppe le minuteur s'il tourne encore
  if (state.tick){ clearInterval(state.tick); state.tick = null; }
  // disarm anti-cheat
  state.antiCheatArmed = false;
  // flush any pending off-window period
  try{ __tf.endOff('finish'); }catch(e){}
  // Compute score + details for admin modal
  var correct = 0;
  var answers = [];
  var answersDetails = [];
  for (var i=0;i<state.questions.length;i++){
    var q = state.questions[i];
    var chosen = (q.id in state.chosen) ? state.chosen[q.id] : -1;
    var otherText = (chosen === 'other' && state.otherText && state.otherText[q.id]) ? state.otherText[q.id] : null;
    answers.push({ questionId: q.id, chosenIndex: chosen, correctIndex: q.correctIndex });
    if (q.correctIndex >= 0 && chosen === q.correctIndex) correct++;
    answersDetails.push({
      questionId: q.id,
      questionText: q.text,
      options: q.options,
      chosenIndex: chosen,
      correctIndex: q.correctIndex,
      focusLosses: (state.focusStats[q.id] && state.focusStats[q.id].losses) || 0,
      offWindowMs: (state.focusStats[q.id] && state.focusStats[q.id].ms) || 0,
      otherText: otherText
    });
  }
  // compute trust score
  if (DEBUG_TRUST) console.log('[trust] before compute', JSON.parse(JSON.stringify(state.trust)));
  var trustScore = __tf.computeScore();
  if (DEBUG_TRUST) console.log('[trust] score', trustScore);
  state.trust.score = trustScore;
  var payload = {
    candidateName: String(els.name.value||"").trim(),
    quizId: state.quizId,
    quizTitle: state.quizTitle,
    score: correct,
    total: state.questions.length,
    answers: answers,
    answersDetails: answersDetails,
    endedBy: endedBy || null,
    trust: state.trust,
    uid: auth.currentUser ? auth.currentUser.uid : null,
    createdAt: serverTimestamp()
  };
  addDoc(collection(db, "results"), payload).then(function(){
    if (els.cardQuiz) els.cardQuiz.style.display = "none";
    if (els.cardResults) els.cardResults.style.display = "block";
    if (els.scoreText){
      els.scoreText.textContent = "Score : "+correct+" / "+state.questions.length + (endedBy==='anti-cheat' ? " (fin prématurée : anti‑triche)" : "");
    }
  }).catch(function(e){
    console.error("[saveResults] error:", e);
    alert("Impossible d’enregistrer le résultat.");
    // Show panel anyway
    if (els.cardQuiz) els.cardQuiz.style.display = "none";
    if (els.cardResults) els.cardResults.style.display = "block";
    if (els.scoreText){
      els.scoreText.textContent = "Score : "+correct+" / "+state.questions.length + (endedBy==='anti-cheat' ? " (fin prématurée : anti‑triche)" : "");
    }
  });
}

// --- Silent trust-factor tracking injected here ---
// We start timing when page loses visibility or window blurs; we stop when visible/focus returns.
document.addEventListener('visibilitychange', function(){ if (DEBUG_TRUST) console.log('[trust] visibilitychange hidden=', document.hidden);
  if (!state.trackingEnabled) return;
  if (document.hidden){ __tf.beginOff('visibility'); }
  else { __tf.endOff('visibility'); }
});
window.addEventListener('blur', function(){ if (DEBUG_TRUST) console.log('[trust] blur'); if (state.trackingEnabled) __tf.beginOff('blur'); });
window.addEventListener('focus', function(){ if (DEBUG_TRUST) console.log('[trust] focus'); if (state.trackingEnabled) __tf.endOff('focus'); });

// --- Wire events ---
if (els.startBtn) els.startBtn.addEventListener("click", function(e){ e.preventDefault(); startQuiz(); });
if (els.nextBtn) els.nextBtn.addEventListener("click", function(e){ e.preventDefault(); nextOrFinish(); });
if (els.prevBtn) els.prevBtn.addEventListener("click", function(e){ e.preventDefault(); prev(); });

// --- Init ---
ensureAnonAuth().then(function(){ return loadQuizzes(); });


// ===== PATCH AUTRES =====
window.__renderOtherPatch = function(question){
  if(!question.otherEnabled) return;
  const answers = document.getElementById('answers');
  if(!answers) return;
  const labels = answers.querySelectorAll('label');
  if(labels[3]){
    labels[3].innerHTML = '<input type="radio" name="answer" value="other"> Autres : <input type="text" id="otherText" style="display:none">';
    const radio = labels[3].querySelector('input[type=radio]');
    const input = labels[3].querySelector('#otherText');
    radio.addEventListener('change', ()=> input.style.display='inline-block');
  }
};
