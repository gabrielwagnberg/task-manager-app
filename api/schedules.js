const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SCHEDULE_HEADERS = [
  'Schedule ID', 'Name', 'Owner', 'Shared', 'Assigned To', 'Project',
  'Start Time', 'End Time', 'Frequency', 'Rate', 'Series Start', 'Series End',
];
const OVERRIDE_HEADERS = [
  'Override ID', 'Schedule ID', 'Original Date', 'Override Type',
  'New Date', 'New Start Time', 'New End Time',
];

const ensureHeaders = async (sheet, required) => {
  await sheet.loadHeaderRow();
  const existing = sheet.headerValues || [];
  const missing = required.filter(h => !existing.includes(h));
  if (missing.length > 0) await sheet.setHeaderRow([...existing, ...missing]);
};

const initializeDoc = async () => {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS not set');
  const credentials = JSON.parse(credentialsJson);
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet('1PVqagEBrE27H7H9ljZ9GX8dSUDU-d85YKWjx7mRItjg');
  doc.auth = auth;
  await doc.loadInfo();
  return doc;
};

const getOrCreateSheet = async (doc, title, headers) => {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) sheet = await doc.addSheet({ title, headerValues: headers });
  return sheet;
};

module.exports = async (req, res) => {
  const method = req.method;
  try {
    const doc = await initializeDoc();

    // ── GET: return all schedules + overrides visible to the user ─────────
    if (method === 'GET') {
      const user = req.query.user;
      const schedSheet = await getOrCreateSheet(doc, 'Schedules', SCHEDULE_HEADERS);
      const overSheet  = await getOrCreateSheet(doc, 'Schedule Overrides', OVERRIDE_HEADERS);
      await ensureHeaders(schedSheet, SCHEDULE_HEADERS);
      await ensureHeaders(overSheet,  OVERRIDE_HEADERS);

      const schedRows = await schedSheet.getRows();
      const overRows  = await overSheet.getRows();

      const visible = schedRows.filter(r => {
        const isShared = r.get('Shared') === 'TRUE' || r.get('Shared') === true;
        return isShared || r.get('Owner') === user;
      });
      const visibleIds = new Set(visible.map(r => String(r.get('Schedule ID'))));

      const schedules = visible.map(r => ({
        id:          r.get('Schedule ID'),
        name:        r.get('Name') || '',
        owner:       r.get('Owner') || '',
        shared:      r.get('Shared') === 'TRUE' || r.get('Shared') === true,
        assignedTo:  r.get('Assigned To') || '',
        project:     r.get('Project') || '',
        startTime:   r.get('Start Time') || '',
        endTime:     r.get('End Time') || '',
        frequency:   r.get('Frequency') || 1,
        rate:        r.get('Rate') || 'weeks',
        seriesStart: r.get('Series Start') || '',
        seriesEnd:   r.get('Series End') || '',
      }));

      const overrides = overRows
        .filter(r => visibleIds.has(String(r.get('Schedule ID'))))
        .map(r => ({
          id:           r.get('Override ID'),
          scheduleId:   r.get('Schedule ID'),
          originalDate: r.get('Original Date') || '',
          overrideType: r.get('Override Type') || '',
          newDate:      r.get('New Date') || '',
          newStartTime: r.get('New Start Time') || '',
          newEndTime:   r.get('New End Time') || '',
        }));

      return res.status(200).json({ schedules, overrides });
    }

    // ── POST: create a schedule series or a one-off override ─────────────
    if (method === 'POST') {
      const { resource } = req.body;

      if (resource === 'schedule') {
        const { name, owner, shared, assignedTo, project, startTime, endTime,
                frequency, rate, seriesStart, seriesEnd } = req.body;
        if (!name)        return res.status(400).json({ error: 'Name is required' });
        if (!seriesStart) return res.status(400).json({ error: 'Series start date is required' });

        const schedSheet = await getOrCreateSheet(doc, 'Schedules', SCHEDULE_HEADERS);
        await ensureHeaders(schedSheet, SCHEDULE_HEADERS);
        const rows  = await schedSheet.getRows();
        const newId = Math.max(...rows.map(r => parseInt(r.get('Schedule ID')) || 0), 0) + 1;

        await schedSheet.addRow({
          'Schedule ID': newId, Name: name,
          Owner: owner || '', Shared: shared ? 'TRUE' : 'FALSE',
          'Assigned To': assignedTo || '', Project: project || '',
          'Start Time': startTime, 'End Time': endTime,
          Frequency: frequency || 1, Rate: rate || 'weeks',
          'Series Start': seriesStart, 'Series End': seriesEnd || '',
        });
        return res.status(201).json({ id: newId, name, owner, shared, assignedTo, project,
          startTime, endTime, frequency: frequency || 1, rate: rate || 'weeks', seriesStart, seriesEnd: seriesEnd || '' });
      }

      if (resource === 'override') {
        const { scheduleId, originalDate, overrideType, newDate, newStartTime, newEndTime } = req.body;
        if (!scheduleId || !originalDate || !overrideType)
          return res.status(400).json({ error: 'scheduleId, originalDate, overrideType required' });

        const overSheet = await getOrCreateSheet(doc, 'Schedule Overrides', OVERRIDE_HEADERS);
        await ensureHeaders(overSheet, OVERRIDE_HEADERS);
        const rows  = await overSheet.getRows();
        const newId = Math.max(...rows.map(r => parseInt(r.get('Override ID')) || 0), 0) + 1;

        await overSheet.addRow({
          'Override ID': newId, 'Schedule ID': scheduleId,
          'Original Date': originalDate, 'Override Type': overrideType,
          'New Date': newDate || '', 'New Start Time': newStartTime || '', 'New End Time': newEndTime || '',
        });
        return res.status(201).json({ id: newId, scheduleId, originalDate, overrideType,
          newDate: newDate || '', newStartTime: newStartTime || '', newEndTime: newEndTime || '' });
      }

      return res.status(400).json({ error: 'Unknown resource' });
    }

    // ── PUT: edit a schedule series ───────────────────────────────────────
    if (method === 'PUT') {
      const { resource, id } = req.body;

      if (resource === 'schedule') {
        const schedSheet = await getOrCreateSheet(doc, 'Schedules', SCHEDULE_HEADERS);
        await ensureHeaders(schedSheet, SCHEDULE_HEADERS);
        const rows = await schedSheet.getRows();
        const row  = rows.find(r => r.get('Schedule ID') == id);
        if (!row) return res.status(404).json({ error: 'Schedule not found' });

        const { name, shared, assignedTo, project, startTime, endTime,
                frequency, rate, seriesStart, seriesEnd } = req.body;
        if (name        !== undefined) row.set('Name',        name);
        if (shared      !== undefined) row.set('Shared',      shared ? 'TRUE' : 'FALSE');
        if (assignedTo  !== undefined) row.set('Assigned To', assignedTo || '');
        if (project     !== undefined) row.set('Project',     project || '');
        if (startTime   !== undefined) row.set('Start Time',  startTime || '');
        if (endTime     !== undefined) row.set('End Time',    endTime || '');
        if (frequency   !== undefined) row.set('Frequency',   frequency || 1);
        if (rate        !== undefined) row.set('Rate',        rate || 'weeks');
        if (seriesStart !== undefined) row.set('Series Start', seriesStart || '');
        if (seriesEnd   !== undefined) row.set('Series End',  seriesEnd || '');
        await row.save();
        return res.status(200).json({ id });
      }

      return res.status(400).json({ error: 'Unknown resource' });
    }

    // ── DELETE: remove a series (+ its overrides) or a single override ────
    if (method === 'DELETE') {
      const { resource, id } = req.body;

      if (resource === 'schedule') {
        const schedSheet = await getOrCreateSheet(doc, 'Schedules', SCHEDULE_HEADERS);
        await ensureHeaders(schedSheet, SCHEDULE_HEADERS);
        const overSheet  = await getOrCreateSheet(doc, 'Schedule Overrides', OVERRIDE_HEADERS);
        await ensureHeaders(overSheet, OVERRIDE_HEADERS);

        const schedRows = await schedSheet.getRows();
        const row = schedRows.find(r => r.get('Schedule ID') == id);
        if (!row) return res.status(404).json({ error: 'Schedule not found' });
        await row.delete();

        // Cascade: delete all overrides for this series
        const overRows = await overSheet.getRows();
        for (const or of overRows.filter(r => r.get('Schedule ID') == id)) await or.delete();

        return res.status(200).json({ id });
      }

      if (resource === 'override') {
        const overSheet = await getOrCreateSheet(doc, 'Schedule Overrides', OVERRIDE_HEADERS);
        await ensureHeaders(overSheet, OVERRIDE_HEADERS);
        const rows = await overSheet.getRows();
        const row  = rows.find(r => r.get('Override ID') == id);
        if (!row) return res.status(404).json({ error: 'Override not found' });
        await row.delete();
        return res.status(200).json({ id });
      }

      return res.status(400).json({ error: 'Unknown resource' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Schedules API error:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
