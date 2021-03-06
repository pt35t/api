/**
 * Copyright (c) 2018, 2019 National Digital ID COMPANY LIMITED
 *
 * This file is part of NDID software.
 *
 * NDID is the free software: you can redistribute it and/or modify it under
 * the terms of the Affero GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or any later
 * version.
 *
 * NDID is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the Affero GNU General Public License for more details.
 *
 * You should have received a copy of the Affero GNU General Public License
 * along with the NDID source code. If not, see https://www.gnu.org/licenses/agpl.txt.
 *
 * Please contact info@ndid.co.th for any further questions
 *
 */

import EventEmitter from 'events';
import * as MQProtocol from './mq_protocol';
import MQRecvSocket from './mq_recv_socket';

import CustomError from 'ndid-error/custom_error';
import errorType from 'ndid-error/type';

export default class MQRecv extends EventEmitter {
  constructor(config) {
    super();
    this.recvSocket = new MQRecvSocket({
      maxMsgSize: config.maxMsgSize,
      port: config.port,
    });

    this.recvSocket.on(
      'message',
      function(identity, messageBuffer) {
        let jsonMessage;
        try {
          jsonMessage = MQProtocol.extractMsg(messageBuffer);
        } catch (error) {
          this.emit(
            'error',
            new CustomError({
              errorType: errorType.WRONG_MESSAGE_QUEUE_PROTOCOL,
              cause: error,
            })
          );
          return;
        }
        const ackMSG = MQProtocol.generateAckMsg(config.senderId, {
          msgId: jsonMessage.retryspec.msgId,
          seqId: jsonMessage.retryspec.seqId,
        });

        // this.recvSocket.send(identity, ackMSG);
        this.emit('message', {
          message: jsonMessage.message,
          msgId: jsonMessage.retryspec.msgId,
          senderId: jsonMessage.senderId,
          sendAck: () => this.recvSocket.send(identity, ackMSG),
        });
      }.bind(this)
    );

    this.recvSocket.on(
      'error',
      function(error) {
        this.emit(
          'error',
          new CustomError({
            errorType: errorType.MQ_RECV_ERROR,
            cause: error,
          })
        );
      }.bind(this)
    );
  }

  close() {
    this.recvSocket.close();
  }
}
