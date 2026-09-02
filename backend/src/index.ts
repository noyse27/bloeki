import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app';
import { createSocketServer } from './realtime/socketServer';
import { startTableCleanupSchedule, startChatCleanupSchedule, startTrailerScanSchedule } from './services/scheduler';

const port = Number(process.env.PORT ?? 4000);

const app = createApp();
const httpServer = createServer(app);
createSocketServer(httpServer);
startTrailerScanSchedule();
startTableCleanupSchedule();
startChatCleanupSchedule();

httpServer.listen(port, () => {
  console.log(`bloeki backend listening on port ${port}`);
});
