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

import fs from 'fs';
import path from 'path';

import CustomError from '../../error/custom_error';
import logger from '../../logger';

import * as tendermintNdid from '../../tendermint/ndid';
import * as mq from '../../mq';
import * as config from '../../config';
import * as db from '../../db';

export * from './event_handlers';

export const callbackUrls = {};

const callbackUrlFilesPrefix = path.join(
  config.dataDirectoryPath,
  'rp-callback-url-' + config.nodeId
);

[{ key: 'error_url', fileSuffix: 'error' }].forEach(({ key, fileSuffix }) => {
  try {
    callbackUrls[key] = fs.readFileSync(
      callbackUrlFilesPrefix + '-' + fileSuffix,
      'utf8'
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn({
        message: `${fileSuffix} callback url file not found`,
      });
    } else {
      logger.error({
        message: `Cannot read ${fileSuffix} callback url file`,
        error,
      });
    }
  }
});

function writeCallbackUrlToFile(fileSuffix, url) {
  fs.writeFile(callbackUrlFilesPrefix + '-' + fileSuffix, url, (err) => {
    if (err) {
      logger.error({
        message: `Cannot write ${fileSuffix} callback url file`,
        error: err,
      });
    }
  });
}

export function setCallbackUrls({ error_url }) {
  if (error_url != null) {
    callbackUrls.error_url = error_url;
    writeCallbackUrlToFile('error', error_url);
  }
}

export function getCallbackUrls() {
  return callbackUrls;
}

export function getErrorCallbackUrl() {
  return callbackUrls.error_url;
}

export function isAllIdpResponsesValid(responseValidList) {
  for (let i = 0; i < responseValidList.length; i++) {
    const { valid_proof, valid_ial } = responseValidList[i];
    if (valid_proof !== true || valid_ial !== true) {
      return false;
    }
  }
  return true;
}

export function isAllIdpRespondedAndValid({
  requestStatus,
  responseValidList,
}) {
  if (requestStatus.status !== 'confirmed') return false;
  if (requestStatus.answered_idp_count !== requestStatus.min_idp) return false;
  if (requestStatus.closed === true || requestStatus.timed_out === true)
    return false;
  const asAnswerCount = requestStatus.service_list.reduce(
    (total, service) => total + service.signed_data_count,
    0
  );
  if (asAnswerCount === 0) {
    // Send request to AS only when all IdP responses' proof and IAL are valid in mode 3
    if (
      requestStatus.mode === 1 ||
      (requestStatus.mode === 3 && isAllIdpResponsesValid(responseValidList))
    ) {
      return true;
    }
  }
  return false;
}

async function getASReceiverList(data_request) {
  let nodeIdList;
  if (!data_request.as_id_list || data_request.as_id_list.length === 0) {
    const asNodes = await tendermintNdid.getAsNodesByServiceId({
      service_id: data_request.service_id,
    });
    nodeIdList = asNodes.map((asNode) => asNode.node_id);
  } else {
    nodeIdList = data_request.as_id_list;
  }

  const receivers = (await Promise.all(
    nodeIdList.map(async (nodeId) => {
      try {
        //let nodeId = node.node_id;
        let mqAddress = await tendermintNdid.getMsqAddress(nodeId);
        if (!mqAddress) return null;
        let { ip, port } = mqAddress;
        return {
          node_id: nodeId,
          ip,
          port,
          ...(await tendermintNdid.getNodePubKey(nodeId)),
        };
      } catch (error) {
        return null;
      }
    })
  )).filter((elem) => elem !== null);
  return receivers;
}

export async function sendRequestToAS(requestData, height) {
  logger.debug({
    message: 'Sending request to AS',
    requestData,
    height,
  });

  if (requestData.data_request_list == null) return;
  if (requestData.data_request_list.length === 0) return;

  const dataToSendByNodeId = {};
  await Promise.all(
    requestData.data_request_list.map(async (data_request, index) => {
      const receivers = await getASReceiverList(data_request);
      if (receivers.length === 0) {
        logger.error({
          message: 'No AS found',
          data_request,
        });
        return;
      }

      const serviceDataRequest = {
        service_id: data_request.service_id,
        request_params: data_request.request_params,
        request_params_salt: requestData.data_request_params_salt_list[index],
      };
      receivers.forEach((receiver) => {
        if (dataToSendByNodeId[receiver.node_id]) {
          dataToSendByNodeId[receiver.node_id].service_data_request_list.push(
            serviceDataRequest
          );
        } else {
          dataToSendByNodeId[receiver.node_id] = {
            receiver,
            service_data_request_list: [serviceDataRequest],
          };
        }
      });
    })
  );

  const challenge = await db.getChallengeFromRequestId(requestData.request_id);
  await Promise.all(
    Object.values(dataToSendByNodeId).map(
      ({ receiver, service_data_request_list }) =>
        mq.send([receiver], {
          type: 'data_request',
          request_id: requestData.request_id,
          mode: requestData.mode,
          namespace: requestData.namespace,
          identifier: requestData.identifier,
          service_data_request_list,
          request_message: requestData.request_message,
          request_message_salt: requestData.request_message_salt,
          challenge,
          privateProofObjectList: requestData.privateProofObjectList,
          rp_id: requestData.rp_id,
          height,
        })
    )
  );
}

export async function getRequestIdByReferenceId(referenceId) {
  try {
    return await db.getRequestIdByReferenceId(referenceId);
  } catch (error) {
    throw new CustomError({
      message: 'Cannot get data received from AS',
      cause: error,
    });
  }
}

export async function getDataFromAS(requestId) {
  try {
    // Check if request exists
    const request = await tendermintNdid.getRequest({ requestId });
    if (request == null) {
      return null;
    }

    return await db.getDatafromAS(requestId);
  } catch (error) {
    throw new CustomError({
      message: 'Cannot get data received from AS',
      cause: error,
    });
  }
}

export async function removeDataFromAS(requestId) {
  try {
    return await db.removeDataFromAS(requestId);
  } catch (error) {
    throw new CustomError({
      message: 'Cannot remove data received from AS',
      cause: error,
    });
  }
}

export async function removeAllDataFromAS() {
  try {
    return await db.removeAllDataFromAS();
  } catch (error) {
    throw new CustomError({
      message: 'Cannot remove all data received from AS',
      cause: error,
    });
  }
}