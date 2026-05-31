const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Initialize the Google Sheet
const initializeSheet = async () => {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error('GOOGLE_CREDENTIALS environment variable not set');
  }

  const credentials = JSON.parse(credentialsJson);
  const sheetId = '1PVqagEBrE27H7H9ljZ9GX8dSUDU-d85YKWjx7mRItjg'; // Your sheet ID

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

// Main handler — routes requests based on HTTP method
exports.handler = async (event, context) => {
  const method = event.httpMethod;

  try {
    if (method === 'GET') {
      // Get all tasks
      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const tasks = rows.map(row => ({
        id: row.get('Task ID'),
        name: row.get('Task Name'),
        completed: row.get('Completed') === 'TRUE' || row.get('Completed') === true,
      }));

      return {
        statusCode: 200,
        body: JSON.stringify(tasks),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'POST') {
      // Add a new task
      const { name } = JSON.parse(event.body);

      if (!name) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Task name is required' }),
        };
      }

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Task ID')) || 0), 0);
      const newId = maxId + 1;

      await sheet.addRow({
        'Task ID': newId,
        'Task Name': name,
        'Completed': 'FALSE',
      });

      return {
        statusCode: 201,
        body: JSON.stringify({ id: newId, name, completed: false }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'PUT') {
      // Update a task (toggle completed)
      const { id, completed } = JSON.parse(event.body);

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Task ID') == id);

      if (!row) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Task not found' }),
        };
      }

      row.set('Completed', completed ? 'TRUE' : 'FALSE');
      await row.save();

      return {
        statusCode: 200,
        body: JSON.stringify({ id, completed }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'DELETE') {
      // Delete a task
      const { id } = JSON.parse(event.body);

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Task ID') == id);

      if (!row) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Task not found' }),
        };
      }

      await row.delete();

      return {
        statusCode: 200,
        body: JSON.stringify({ id }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error: ' + error.message }),
    };
  }
};
