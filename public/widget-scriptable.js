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
const WF       = config.widgetFamily || 'medium';
const DIM      = DIMS[WF] || DIMS.medium;
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
// NOTE: Scriptable's Request.loadJSON() does NOT work with Promise.all() —
//       each request must be awaited individually.
async function fetchAll() {
    try {
        const tasksReq = new Request(`${API_URL}/tasks?user=${encodeURIComponent(USER)}`);
        const tasks    = await tasksReq.loadJSON();

        const schedsReq = new Request(`${API_URL}/schedules?user=${encodeURIComponent(USER)}`);
        const schedData = await schedsReq.loadJSON();

        const specialsReq = new Request(`${API_URL}/specials?user=${encodeURIComponent(USER)}`);
        const specData    = await specialsReq.loadJSON();

        return {
            tasks,
            schedules:   schedData.schedules  || [],
            overrides:   schedData.overrides  || [],
            birthdays:   specData.birthdays   || [],
            specialDays: specData.specialDays || [],
        };
    } catch (e) {
        // Return empty data — calendar will still render (just no dots)
        return { tasks:[], schedules:[], overrides:[], birthdays:[], specialDays:[] };
    }
}

// ── Build per-day dot colours ─────────────────────────────────────────────────
function buildDayDots(data, year, month, daysInMonth, today) {
    const result = {}; // day number → array of hex colour strings

    for (let d = 1; d <= daysInMonth; d++) {
        const ds   = `${year}-${pad(month+1)}-${pad(d)}`;
        const md   = `${pad(month+1)}-${pad(d)}`;
        const dots = [];

        // Birthdays — amber/yellow
        data.birthdays.forEach(b => {
            if (b.date === md) dots.push('#f59e0b');
        });

        // Holidays / special days — mint green
        data.specialDays.forEach(s => {
            const match = (s.recurring === true || s.recurring === 'true')
                ? s.date === md
                : s.date === ds;
            if (match) dots.push('#10b981');
        });

        // Schedule blocks — purple
        data.schedules.forEach(s => {
            if (!isOccurrence(s, ds)) return;
            const ov = data.overrides.find(o =>
                String(o.scheduleId) === String(s.id) && o.originalDate === ds);
            if (ov && ov.overrideType === 'cancelled') return;
            dots.push('#7c3aed');
        });

        // Tasks — colour by assignedTo / shared
        data.tasks.forEach(t => {
            if (t.completed) return;
            let date = t.recurring ? t.nextDue : t.dueDate;
            if (!date) return;
            if (t.recurring && date < today) date = today; // overdue → pin to today
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

// ── Draw calendar with DrawContext (no WebView / no snapshot) ─────────────────
// DrawContext is Scriptable's native canvas API — reliable in all widget families.
function drawCalendar(data, today) {
    const W = DIM.w;
    const H = DIM.h;

    const now         = new Date();
    const year        = now.getFullYear();
    const month       = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow    = new Date(year, month, 1).getDay();
    const startPad    = (firstDow + 6) % 7; // Mon=0 … Sun=6
    const prevDays    = new Date(year, month, 0).getDate();

    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];

    // ── Layout constants (medium vs large) ───────────────────────────────────
    const HEADER_H = IS_LARGE ? 26 : 18;
    const DOW_H    = IS_LARGE ? 14 : 11;
    const GRID_Y   = HEADER_H + DOW_H;
    const CELL_W   = W / 7;
    const numRows  = Math.ceil((startPad + daysInMonth) / 7);
    const CELL_H   = (H - GRID_Y) / numRows;

    const HEADER_SZ = IS_LARGE ? 13 : 10;
    const USER_SZ   = IS_LARGE ? 10 :  8;
    const DOW_SZ    = IS_LARGE ?  8 :  6;
    const NUM_SZ    = IS_LARGE ? 11 :  8;
    const DOT_D     = IS_LARGE ?  5 :  3;   // dot diameter
    const TODAY_D   = IS_LARGE ? 16 : 12;   // today-circle diameter
    const MAX_DOTS  = IS_LARGE ?  5 :  3;

    // ── Canvas ────────────────────────────────────────────────────────────────
    const dc = new DrawContext();
    dc.size = new Size(W, H);
    dc.opaque = true;
    dc.respectScreenScale = true;

    // Background
    dc.setFillColor(Color.white());
    dc.fillRect(new Rect(0, 0, W, H));

    // ── Header ────────────────────────────────────────────────────────────────
    // Month + year (left)
    dc.setTextColor(new Color('#1a1a1a'));
    dc.setFont(Font.boldSystemFont(HEADER_SZ));
    dc.setTextAlignedLeft();
    dc.drawTextInRect(
        `${MONTH_NAMES[month]} ${year}`,
        new Rect(6, (HEADER_H - HEADER_SZ) / 2, W * 0.65, HEADER_SZ + 4)
    );

    // User name (right)
    dc.setTextColor(new Color('#aaaaaa'));
    dc.setFont(Font.systemFont(USER_SZ));
    dc.setTextAlignedRight();
    dc.drawTextInRect(
        USER,
        new Rect(W * 0.55, (HEADER_H - USER_SZ) / 2, W * 0.42, USER_SZ + 4)
    );

    // Header separator line
    dc.setFillColor(new Color('#f0f0f0'));
    dc.fillRect(new Rect(0, HEADER_H, W, 1));

    // ── Day-of-week row ───────────────────────────────────────────────────────
    const DAY_LABELS = ['M','T','W','T','F','S','S'];
    dc.setTextColor(new Color('#aaaaaa'));
    dc.setFont(Font.boldSystemFont(DOW_SZ));
    dc.setTextAlignedCenter();
    for (let i = 0; i < 7; i++) {
        dc.drawTextInRect(
            DAY_LABELS[i],
            new Rect(i * CELL_W, HEADER_H + 1 + (DOW_H - DOW_SZ) / 2, CELL_W, DOW_SZ + 2)
        );
    }

    // DOW separator
    dc.setFillColor(new Color('#eeeeee'));
    dc.fillRect(new Rect(0, GRID_Y - 1, W, 1));

    // ── Per-day dot data ──────────────────────────────────────────────────────
    const dayDots = buildDayDots(data, year, month, daysInMonth, today);

    // ── Draw one calendar cell ────────────────────────────────────────────────
    function drawCell(col, row, dayNum, isCurrentMonth, isToday) {
        const x = col * CELL_W;
        const y = GRID_Y + row * CELL_H;

        // Cell background
        if (isToday) {
            dc.setFillColor(new Color('#eff6ff'));
        } else if (!isCurrentMonth) {
            dc.setFillColor(new Color('#f9f9f9'));
        } else {
            dc.setFillColor(Color.white());
        }
        dc.fillRect(new Rect(x, y, CELL_W, CELL_H));

        // Grid lines (right edge + bottom edge)
        dc.setFillColor(new Color('#eeeeee'));
        if (col < 6) dc.fillRect(new Rect(x + CELL_W - 0.5, y, 0.5, CELL_H));
        dc.fillRect(new Rect(x, y + CELL_H - 0.5, CELL_W, 0.5));

        // ── Day number ────────────────────────────────────────────────────────
        if (isToday) {
            // Blue filled circle behind the number
            const cx = x + CELL_W * 0.22;
            const cy = y + 2 + TODAY_D / 2;
            dc.setFillColor(new Color('#2563eb'));
            dc.fillEllipse(new Rect(cx - TODAY_D / 2, cy - TODAY_D / 2, TODAY_D, TODAY_D));
            dc.setTextColor(Color.white());
            dc.setFont(Font.boldSystemFont(NUM_SZ));
            dc.setTextAlignedCenter();
            dc.drawTextInRect(
                String(dayNum),
                new Rect(cx - TODAY_D / 2, cy - NUM_SZ / 2 - 0.5, TODAY_D, NUM_SZ + 2)
            );
        } else {
            dc.setTextColor(isCurrentMonth ? new Color('#1a1a1a') : new Color('#cccccc'));
            dc.setFont(Font.systemFont(NUM_SZ));
            dc.setTextAlignedLeft();
            dc.drawTextInRect(
                String(dayNum),
                new Rect(x + 3, y + 2, CELL_W * 0.6, NUM_SZ + 2)
            );
        }

        // ── Coloured dots (current month only) ────────────────────────────────
        if (isCurrentMonth && dayDots[dayNum] && dayDots[dayNum].length > 0) {
            const dots         = dayDots[dayNum].slice(0, MAX_DOTS);
            const totalDotsW   = dots.length * DOT_D + (dots.length - 1) * 2;
            const dotStartX    = x + (CELL_W - totalDotsW) / 2;
            const dotY         = y + CELL_H - DOT_D - 3;
            dots.forEach((color, i) => {
                dc.setFillColor(new Color(color));
                dc.fillEllipse(new Rect(
                    dotStartX + i * (DOT_D + 2),
                    dotY,
                    DOT_D,
                    DOT_D
                ));
            });
        }
    }

    // ── Lay out all cells ─────────────────────────────────────────────────────
    let col = 0, row = 0;

    // Leading padding (prev month's tail days)
    for (let i = startPad - 1; i >= 0; i--) {
        drawCell(col, row, prevDays - i, false, false);
        col++;
        if (col === 7) { col = 0; row++; }
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${pad(month+1)}-${pad(d)}`;
        drawCell(col, row, d, true, ds === today);
        col++;
        if (col === 7) { col = 0; row++; }
    }

    // Trailing padding (next month's leading days)
    let trail = 1;
    while (col > 0) {
        drawCell(col, row, trail, false, false);
        col++;
        trail++;
        if (col === 7) { col = 0; row++; }
    }

    return dc.getImage();
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
        w.backgroundImage = drawCalendar(data, today);
    } catch (e) {
        // Show the actual error so we can debug if needed
        w.backgroundColor = Color.white();
        const t = w.addText('⚠ ' + (e.message || String(e)));
        t.font = Font.systemFont(10);
        t.textColor = new Color('#dc2626');
        t.minimumScaleFactor = 0.5;
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
