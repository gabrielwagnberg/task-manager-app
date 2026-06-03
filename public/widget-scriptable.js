// ─────────────────────────────────────────────────────────────────────────────
// Task Manager — Scriptable Widget (iOS)
// ─────────────────────────────────────────────────────────────────────────────
//
// SETUP:
//  1. Install "Scriptable" from the App Store (free)
//  2. Open Scriptable → tap "+" → paste this entire file → name it "Task Manager"
//  3. Go to your home screen → long-press → "+" → Scriptable
//  4. Choose size (Medium recommended)
//  5. Long-press the widget → "Edit Widget" → Script: Task Manager
//  6. Set "Parameter" to "Gabriel"  (Thomas uses "Thomas" on his phone)
//
// The widget auto-refreshes every 5 minutes and opens the Calendar tab when tapped.
// ─────────────────────────────────────────────────────────────────────────────

const USER     = (args.widgetParameter || 'Gabriel').trim();
const BASE_URL = 'https://task-manager-app-iota-puce.vercel.app';
const API_URL  = BASE_URL + '/api';
const OPEN_URL = BASE_URL + '?tab=calendar';
const MAX_ROWS = config.widgetFamily === 'large' ? 10 : config.widgetFamily === 'medium' ? 5 : 3;

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
    bg:     Color.white(),
    text:   new Color('#1a1a1a'),
    meta:   new Color('#999999'),
    sched:  new Color('#7c3aed'),
    ok:     new Color('#16a34a'),
    err:    new Color('#dc2626'),
    accent: new Color('#2563eb'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function isOccurrence(s, dateStr) {
    if (!s.seriesStart || dateStr < s.seriesStart) return false;
    if (s.seriesEnd && dateStr > s.seriesEnd) return false;
    const pd = str => { const [y,m,d] = str.split('-').map(Number); return new Date(y,m-1,d); };
    const diff = Math.round((pd(dateStr) - pd(s.seriesStart)) / 86400000);
    if (diff < 0) return false;
    const f = parseInt(s.frequency) || 1;
    if (s.rate === 'days')  return diff % f === 0;
    if (s.rate === 'weeks') return diff % (f * 7) === 0;
    const st = pd(s.seriesStart), ch = pd(dateStr);
    const md = (ch.getFullYear() - st.getFullYear()) * 12 + ch.getMonth() - st.getMonth();
    return md % f === 0 && ch.getDate() === st.getDate();
}

// ── Data fetch ────────────────────────────────────────────────────────────────
async function fetchData() {
    const [tReq, sReq] = [
        new Request(`${API_URL}/tasks?user=${encodeURIComponent(USER)}`),
        new Request(`${API_URL}/schedules?user=${encodeURIComponent(USER)}`),
    ];
    const [tasks, schedData] = await Promise.all([tReq.loadJSON(), sReq.loadJSON()]);
    return { tasks, schedules: schedData.schedules || [], overrides: schedData.overrides || [] };
}

// ── Widget build ──────────────────────────────────────────────────────────────
async function buildWidget() {
    const w = new ListWidget();
    w.backgroundColor = C.bg;
    w.url = OPEN_URL;
    w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

    const today = todayStr();
    const now   = new Date();

    // Header row: app name  ·  date
    const head = w.addStack();
    head.layoutHorizontally();
    head.centerAlignContent();

    const titleT = head.addText('Task Manager');
    titleT.font = Font.boldSystemFont(12);
    titleT.textColor = C.text;

    head.addSpacer();

    const dateLabel = now.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
    const dateT = head.addText(dateLabel);
    dateT.font = Font.systemFont(11);
    dateT.textColor = C.meta;

    w.addSpacer(5);

    // ── Content ───────────────────────────────────────────────────────────────
    try {
        const { tasks, schedules, overrides } = await fetchData();

        const urgent = tasks
            .filter(t => {
                if (t.completed) return false;
                const date = t.recurring ? t.nextDue : t.dueDate;
                return date && date <= today;
            })
            .sort((a, b) => (parseInt(a.priority)||99) - (parseInt(b.priority)||99));

        const scheds = schedules
            .filter(s => {
                if (!isOccurrence(s, today)) return false;
                const ov = overrides.find(o =>
                    String(o.scheduleId) === String(s.id) && o.originalDate === today);
                return !(ov && ov.overrideType === 'cancelled');
            })
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

        if (urgent.length === 0 && scheds.length === 0) {
            const row = w.addStack();
            row.layoutHorizontally();
            const okT = row.addText('✓  All caught up!');
            okT.font = Font.mediumSystemFont(12);
            okT.textColor = C.ok;
        }

        let shown = 0;

        // Schedule blocks
        for (const s of scheds) {
            if (shown >= MAX_ROWS) break;
            const row = w.addStack();
            row.layoutHorizontally();
            row.centerAlignContent();

            const bullet = row.addText('▸ ');
            bullet.font = Font.boldSystemFont(11);
            bullet.textColor = C.sched;

            const nameT = row.addText(s.name);
            nameT.font = Font.mediumSystemFont(11);
            nameT.textColor = C.sched;
            nameT.lineLimit = 1;

            if (s.startTime) {
                row.addSpacer();
                const timeT = row.addText(s.startTime);
                timeT.font = Font.systemFont(10);
                timeT.textColor = C.meta;
            }
            shown++;
        }

        // Tasks
        for (const t of urgent) {
            if (shown >= MAX_ROWS) break;
            const row = w.addStack();
            row.layoutHorizontally();
            row.centerAlignContent();

            const bullet = row.addText('• ');
            bullet.font = Font.systemFont(11);
            bullet.textColor = C.meta;

            const nameT = row.addText(t.name);
            nameT.font = Font.systemFont(11);
            nameT.textColor = C.text;
            nameT.lineLimit = 1;
            shown++;
        }

        const remaining = (urgent.length + scheds.length) - shown;
        if (remaining > 0) {
            w.addSpacer(2);
            const moreT = w.addText(`+${remaining} more`);
            moreT.font = Font.systemFont(10);
            moreT.textColor = C.meta;
        }

    } catch (e) {
        const errT = w.addText('⚠ Could not load data');
        errT.font = Font.systemFont(11);
        errT.textColor = C.err;
    }

    w.addSpacer();

    // Footer: user name
    const footT = w.addText(USER);
    footT.font = Font.systemFont(9);
    footT.textColor = C.meta;

    return w;
}

// ── Run ───────────────────────────────────────────────────────────────────────
const widget = await buildWidget();
if (config.runsInWidget) {
    Script.setWidget(widget);
} else {
    // Preview when running in-app
    await widget.presentMedium();
}
Script.complete();
