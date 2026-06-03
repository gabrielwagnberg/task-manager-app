// ─────────────────────────────────────────────────────────────────────────────
// Task Manager — Scriptable Calendar Widget (iOS)
// Shows the current month grid with coloured dots for tasks, schedules,
// birthdays and special days — exactly like the app's month view.
//
// SETUP:
//  1. Install "Scriptable" from the App Store (free)
//  2. Drop this file into iCloud Drive → Scriptable folder
//  3. Home screen → long-press → + → Scriptable → Medium or Large
//  4. Long-press widget → Edit Widget → Script: widget-scriptable
//  5. Set "Parameter" to "Gabriel"  (Thomas uses "Thomas")
//
// Tapping the widget opens the app directly to the Calendar tab.
// ─────────────────────────────────────────────────────────────────────────────

const USER     = (args.widgetParameter || 'Gabriel').trim();
const BASE_URL = 'https://task-manager-app-iota-puce.vercel.app';
const API_URL  = BASE_URL + '/api';
const OPEN_URL = BASE_URL + '?tab=calendar';

// Logical point dimensions for each widget family
const DIMS = {
    small:       { w: 155, h: 155 },
    medium:      { w: 329, h: 141 },
    large:       { w: 329, h: 345 },
    extraLarge:  { w: 715, h: 345 },
    accessoryInline:      { w: 255, h: 16  },
    accessoryRectangular: { w: 150, h: 60  },
    accessoryCircular:    { w: 68,  h: 68  },
};
const WF  = config.widgetFamily || 'medium';
const DIM = DIMS[WF] || DIMS.medium;
const IS_LARGE = WF === 'large' || WF === 'extraLarge';

// ── Date helpers ──────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

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
    const monthDiff = (ch.getFullYear() - st.getFullYear()) * 12 + ch.getMonth() - st.getMonth();
    return monthDiff % f === 0 && ch.getDate() === st.getDate();
}

// ── Data fetch ────────────────────────────────────────────────────────────────
async function fetchAll() {
    try {
        const reqs = [
            new Request(`${API_URL}/tasks?user=${encodeURIComponent(USER)}`),
            new Request(`${API_URL}/schedules?user=${encodeURIComponent(USER)}`),
            new Request(`${API_URL}/specials?user=${encodeURIComponent(USER)}`),
        ];
        const [tasks, schedData, specData] = await Promise.all(reqs.map(r => r.loadJSON()));
        return {
            tasks,
            schedules:   schedData.schedules  || [],
            overrides:   schedData.overrides  || [],
            birthdays:   specData.birthdays   || [],
            specialDays: specData.specialDays || [],
        };
    } catch (e) {
        return { tasks:[], schedules:[], overrides:[], birthdays:[], specialDays:[] };
    }
}

// ── Build per-day dot colours ─────────────────────────────────────────────────
function buildDayDots(data, year, month, daysInMonth, today) {
    const result = {}; // day number → array of hex colour strings

    for (let d = 1; d <= daysInMonth; d++) {
        const ds  = `${year}-${pad(month+1)}-${pad(d)}`;
        const md  = `${pad(month+1)}-${pad(d)}`;
        const dots = [];

        // Birthdays — light yellow dot
        data.birthdays.forEach(b => {
            if (b.date === md) dots.push('#f59e0b');
        });

        // Special days / holidays — mint green dot
        data.specialDays.forEach(s => {
            const match = (s.recurring === true || s.recurring === 'true')
                ? s.date === md
                : s.date === ds;
            if (match) dots.push('#10b981');
        });

        // Schedule blocks — purple dot
        data.schedules.forEach(s => {
            if (!isOccurrence(s, ds)) return;
            const ov = data.overrides.find(o =>
                String(o.scheduleId) === String(s.id) && o.originalDate === ds);
            if (ov && ov.overrideType === 'cancelled') return;
            dots.push('#7c3aed');
        });

        // Tasks — colour by owner/shared (match app colours)
        data.tasks.forEach(t => {
            if (t.completed) return;
            let date = t.recurring ? t.nextDue : t.dueDate;
            if (!date) return;
            if (t.recurring && date < today) date = today; // overdue → show today
            if (date !== ds) return;
            const color = t.assignedTo === 'Thomas'  ? '#818cf8'
                        : t.assignedTo === 'Gabriel' ? '#fbbf24'
                        : t.shared                   ? '#f87171'
                        :                              '#d1d5db';
            dots.push(color);
        });

        result[d] = dots;
    }
    return result;
}

// ── Build calendar HTML ───────────────────────────────────────────────────────
function buildHTML(data, today) {
    const now          = new Date();
    const year         = now.getFullYear();
    const month        = now.getMonth(); // 0–11
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const firstDow     = new Date(year, month, 1).getDay();
    const startPad     = (firstDow + 6) % 7; // Mon=0 … Sun=6
    const prevDays     = new Date(year, month, 0).getDate();

    const MONTH_NAMES  = ['January','February','March','April','May','June',
                          'July','August','September','October','November','December'];

    const dayDots = buildDayDots(data, year, month, daysInMonth, today);

    // Sizing — scale up for large widgets
    const cellH    = IS_LARGE ? 42 : 20;
    const numSz    = IS_LARGE ? 11 : 8;
    const dotSz    = IS_LARGE ?  6 : 4;
    const headerH  = IS_LARGE ? 30 : 18;
    const headerSz = IS_LARGE ? 13 : 10;
    const dhSz     = IS_LARGE ?  9 : 7;
    const dhPad    = IS_LARGE ?  4 : 2;

    // Day-of-week header row
    const dayLabels = ['M','T','W','T','F','S','S'];
    let gridHtml = dayLabels
        .map(l => `<div class="dh">${l}</div>`)
        .join('');

    // Leading padding (previous month's tail)
    for (let i = startPad - 1; i >= 0; i--) {
        gridHtml += `<div class="dc other"><span class="dn">${prevDays - i}</span></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const ds      = `${year}-${pad(month+1)}-${pad(d)}`;
        const isToday = ds === today;
        const dots    = (dayDots[d] || []).slice(0, IS_LARGE ? 6 : 3);
        const dotHtml = dots.map(c =>
            `<span class="dot" style="background:${c}"></span>`
        ).join('');

        gridHtml += `
            <div class="dc${isToday ? ' today-cell' : ''}">
                <span class="dn${isToday ? ' today-num' : ''}">${d}</span>
                <div class="dots">${dotHtml}</div>
            </div>`;
    }

    // Trailing padding
    const total    = startPad + daysInMonth;
    const trailing = (7 - (total % 7)) % 7;
    for (let d = 1; d <= trailing; d++) {
        gridHtml += `<div class="dc other"><span class="dn">${d}</span></div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=${DIM.w}, initial-scale=1.0">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
    width: ${DIM.w}px;
    height: ${DIM.h}px;
    background: #ffffff;
    font-family: -apple-system, sans-serif;
    overflow: hidden;
}
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: ${headerH}px;
    padding: 0 ${IS_LARGE ? 10 : 7}px;
    border-bottom: 1px solid #f0f0f0;
}
.title {
    font-weight: 700;
    font-size: ${headerSz}px;
    color: #1a1a1a;
}
.user {
    font-size: ${dhSz + 1}px;
    color: #aaaaaa;
}
.grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    background: #eeeeee;
    height: calc(${DIM.h}px - ${headerH}px);
}
.dh {
    background: #f9f9f9;
    text-align: center;
    font-size: ${dhSz}px;
    font-weight: 700;
    color: #aaaaaa;
    padding: ${dhPad}px 0;
    display: flex;
    align-items: center;
    justify-content: center;
}
.dc {
    background: #ffffff;
    padding: ${IS_LARGE ? '3px 4px' : '1px 2px'};
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: ${cellH}px;
}
.dc.today-cell { background: #eff6ff; }
.dc.other .dn  { color: #cccccc; }
.dn {
    font-size: ${numSz}px;
    font-weight: 500;
    color: #1a1a1a;
    line-height: 1;
    min-width: ${numSz + 4}px;
    text-align: center;
}
.dn.today-num {
    background: #2563eb;
    color: #ffffff;
    border-radius: 50%;
    width: ${numSz + 5}px;
    height: ${numSz + 5}px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
}
.dots {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    margin-top: 2px;
}
.dot {
    width: ${dotSz}px;
    height: ${dotSz}px;
    border-radius: 50%;
    flex-shrink: 0;
}
</style>
</head>
<body>
<div class="header">
    <span class="title">${MONTH_NAMES[month]} ${year}</span>
    <span class="user">${USER}</span>
</div>
<div class="grid">${gridHtml}</div>
</body>
</html>`;
}

// ── Build widget ──────────────────────────────────────────────────────────────
async function buildWidget() {
    const w = new ListWidget();
    w.url = OPEN_URL;
    w.setPadding(0, 0, 0, 0);
    w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000); // 15-min refresh

    const today = todayStr();

    try {
        const data = await fetchAll();
        const html = buildHTML(data, today);

        const wv = new WebView();
        await wv.loadHTML(html);
        // Give the HTML a moment to fully render before snapshotting
        await wv.evaluateJavaScript('document.readyState');
        const img = await wv.getSnapshot();
        w.backgroundImage = img;
    } catch (e) {
        // Fallback: plain error text
        w.backgroundColor = Color.white();
        const t = w.addText('⚠ Could not load calendar');
        t.font = Font.systemFont(11);
        t.textColor = new Color('#dc2626');
    }

    return w;
}

// ── Run ───────────────────────────────────────────────────────────────────────
const widget = await buildWidget();
if (config.runsInWidget) {
    Script.setWidget(widget);
} else {
    await widget.presentMedium();
}
Script.complete();
