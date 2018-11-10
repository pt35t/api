import path from 'path';
import fs from 'fs';

import * as config from '../config';

export default function logEvent(data) {
  fs.appendFile(
    path.join(
      __dirname,
      '..',
      '..',
      '_event_log',
      `${process.pid}-${config.nodeId}-event.log`
    ),
    `${JSON.stringify(data)}\n`,
    (error) => {
      console.error('event logging error:', error);
    }
  );
}
