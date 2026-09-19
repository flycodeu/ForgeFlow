import { openDatabase } from './client.js';

try {
  const { sqlite } = openDatabase();
  sqlite.close();
  console.log('Database migrations applied.');
} catch (error) {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
}
