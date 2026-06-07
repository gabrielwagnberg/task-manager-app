const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const initializeSheet = async () => {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS environment variable not set');

  const credentials = JSON.parse(credentialsJson);
  const sheetId = '1PVqagEBrE27H7H9ljZ9GX8dSUDU-d85YKWjx7mRItjg';

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(sheetId);
  doc.auth = auth;
  await doc.loadInfo();
  return doc;
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const doc = await initializeSheet();
    const sheet = doc.sheetsByTitle['Points'];

    // Points sheet doesn't exist yet — return empty array (no one has scored yet).
    if (!sheet) return res.status(200).json([]);

    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    const points = rows.map(row => ({
      id: row.get('Point ID'),
      user: row.get('User'),
      date: row.get('Date'),
      taskId: row.get('Task ID'),
      taskName: row.get('Task Name'),
      pointValue: parseInt(row.get('Point Value')) || 1,
      time: row.get('Time') || '',
    }));

    return res.status(200).json(points);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
