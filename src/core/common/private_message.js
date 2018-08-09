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

import * as tendermintNdid from '../../tendermint/ndid';
import * as longTermDb from '../../db/long_term';
import {
  RP_PRIVATE_MESSAGE_TYPES,
  IDP_PRIVATE_MESSAGE_TYPES,
  AS_PRIVATE_MESSAGE_TYPES,
} from '../private_message_type';
import { role } from '../../config';

import CustomError from '../../error/custom_error';

let privateMessageTypes;
if (role === 'rp') {
  privateMessageTypes = RP_PRIVATE_MESSAGE_TYPES;
} else if (role === 'idp') {
  privateMessageTypes = IDP_PRIVATE_MESSAGE_TYPES;
} else if (role === 'as') {
  privateMessageTypes = AS_PRIVATE_MESSAGE_TYPES;
}

export async function getPrivateMessages({ requestId, type } = {}) {
  try {
    if (requestId == null) {
      if (type == null) {
        const allTypesMessages = await Promise.all(
          privateMessageTypes.map(async (type) =>
            longTermDb.getAllMessages(type)
          )
        );
        return allTypesMessages.reduce(
          (result, messages) => result.concat(messages),
          []
        );
      } else {
        return await longTermDb.getAllMessages(type);
      }
    } else {
      const request = await tendermintNdid.getRequest({ requestId });
      if (request == null) {
        return null;
      }
      if (type == null) {
        const allTypesMessages = await Promise.all(
          privateMessageTypes.map(async (type) =>
            longTermDb.getMessages(type, requestId)
          )
        );
        return allTypesMessages.reduce(
          (result, messages) => result.concat(messages),
          []
        );
      } else {
        return await longTermDb.getMessages(type, requestId);
      }
    }
  } catch (error) {
    throw new CustomError({
      message: 'Cannot get private messages (from message queue)',
      details: {
        requestId,
        type,
      },
      cause: error,
    });
  }
}

export async function removePrivateMessages({ requestId, type } = {}) {
  try {
    if (requestId == null) {
      if (type == null) {
        await Promise.all(
          privateMessageTypes.map(async (type) => {
            longTermDb.removeAllMessages(type);
          })
        );
      } else {
        await longTermDb.removeAllMessages(type);
      }
    } else {
      if (type == null) {
        await Promise.all(
          privateMessageTypes.map(async (type) => {
            longTermDb.removeMessages(type, requestId);
          })
        );
      } else {
        await longTermDb.removeMessages(type, requestId);
      }
    }
  } catch (error) {
    throw new CustomError({
      message: 'Cannot remove private messages (from message queue)',
      details: {
        requestId,
        type,
      },
      cause: error,
    });
  }
}