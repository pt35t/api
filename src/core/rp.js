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

import { callbackToClient } from '../utils/callback';
import CustomError from '../error/custom_error';
import logger from '../logger';

import * as tendermint from '../tendermint';
import * as tendermintNdid from '../tendermint/ndid';
import * as mq from '../mq';
import * as config from '../config';
import * as common from './common';
import * as db from '../db';
import * as utils from '../utils';

const successBase64 = Buffer.from('success').toString('base64');
const trueBase64 = Buffer.from('true').toString('base64');

const callbackUrls = {};

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

/**
 *
 * @param {string} requestId
 * @param {integer} height
 */
async function processRequestUpdate(requestId, height) {
  // logger.debug({
  //   message: 'RP check zk proof and notify',
  //   requestId,
  // });

  const callbackUrl = await db.getRequestCallbackUrl(requestId);
  if (!callbackUrl) return; // This RP does not concern this request

  const requestDetail = await tendermintNdid.getRequestDetail({
    requestId: requestId,
    height,
  });

  const requestStatus = utils.getDetailedRequestStatus(requestDetail);

  // ZK Proof and IAL verification is needed only when got new response from IdP
  let needResponseVerification = false;
  if (
    requestStatus.status !== 'pending' &&
    requestStatus.closed === false &&
    requestStatus.timed_out === false
  ) {
    if (requestStatus.answered_idp_count < requestStatus.min_idp) {
      needResponseVerification = true;
    } else if (requestStatus.answered_idp_count === requestStatus.min_idp) {
      const asAnswerCount = requestStatus.service_list.reduce(
        (total, service) => total + service.signed_data_count,
        0
      );
      if (asAnswerCount === 0) {
        needResponseVerification = true;
      }
    }
  }

  const savedResponseValidList = await db.getIdpResponseValidList(requestId);
  let responseValidList;

  if (needResponseVerification) {
    // Validate ZK Proof and IAL
    const responseMetadataList = await db.getExpectedIdpResponseNodeIdInBlockList(
      height
    );
    const idpNodeIds = responseMetadataList
      .filter(({ requestId: reqId }) => requestId === reqId)
      .map((metadata) => metadata.idpId);

    if (idpNodeIds.length === 0) return;

    const responseValids = await Promise.all(
      idpNodeIds.map((idpNodeId) =>
        common.checkIdpResponse({
          requestStatus,
          idpId: idpNodeId,
          responseIal: requestDetail.response_list.find(
            (response) => response.idp_id === idpNodeId
          ).ial,
        })
      )
    );

    responseValidList = savedResponseValidList.concat(responseValids);
  } else {
    responseValidList = savedResponseValidList;
  }

  const eventDataForCallback = {
    type: 'request_status',
    ...requestStatus,
    response_valid_list: responseValidList,
    block_height: height,
  };

  await callbackToClient(callbackUrl, eventDataForCallback, true);

  if (isAllIdpRespondedAndValid({ requestStatus, responseValidList })) {
    const requestData = await db.getRequestData(requestId);
    if (requestData != null) {
      await sendRequestToAS(requestData, height);
    }
    db.removeChallengeFromRequestId(requestId);
  }

  if (
    requestStatus.status === 'confirmed' &&
    requestStatus.min_idp === requestStatus.answered_idp_count &&
    requestStatus.service_list.length > 0
  ) {
    const metadataList = await db.getExpectedDataSignInBlockList(height);
    await checkAsDataSignaturesAndSetReceived(requestId, metadataList);
  }

  if (
    requestStatus.status === 'completed' &&
    !requestStatus.closed &&
    !requestStatus.timed_out &&
    (requestStatus.mode === 1 ||
      (requestStatus.mode === 3 && isAllIdpResponsesValid(responseValidList)))
  ) {
    await common.closeRequest({ request_id: requestId }, { synchronous: true });
  }

  if (requestStatus.closed || requestStatus.timed_out) {
    // Clean up
    // Clear callback url mapping, reference ID mapping, and request data to send to AS
    // since the request is no longer going to have further events
    // (the request has reached its end state)
    db.removeRequestCallbackUrl(requestId);
    db.removeRequestIdReferenceIdMappingByRequestId(requestId);
    db.removeRequestData(requestId);
    db.removeIdpResponseValidList(requestId);
    db.removeTimeoutScheduler(requestId);
    clearTimeout(common.timeoutScheduler[requestId]);
    delete common.timeoutScheduler[requestId];
  }
}

function isAllIdpResponsesValid(responseValidList) {
  for (let i = 0; i < responseValidList.length; i++) {
    const { valid_proof, valid_ial } = responseValidList[i];
    if (valid_proof !== true || valid_ial !== true) {
      return false;
    }
  }
  return true;
}

function isAllIdpRespondedAndValid({ requestStatus, responseValidList }) {
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

export async function handleTendermintNewBlockHeaderEvent(
  error,
  result,
  missingBlockCount
) {
  if (missingBlockCount == null) return;
  try {
    const height = tendermint.getBlockHeightFromNewBlockHeaderEvent(result);
    const fromHeight =
      missingBlockCount === 0 ? height - 1 : height - missingBlockCount;
    const toHeight = height - 1;

    //loop through all those block before, and verify all proof
    logger.debug({
      message: 'Getting request IDs to process responses',
      fromHeight,
      toHeight,
    });

    const [blocks, blockResults] = await Promise.all([
      tendermint.getBlocks(fromHeight, toHeight),
      tendermint.getBlockResults(fromHeight, toHeight),
    ]);
    await Promise.all(
      blocks.map(async (block, blockIndex) => {
        let transactions = tendermint.getTransactionListFromBlockQuery(block);
        transactions = transactions.filter((transaction, index) => {
          const deliverTxResult =
            blockResults[blockIndex].results.DeliverTx[index];
          const successTag = deliverTxResult.tags.find(
            (tag) => tag.key === successBase64
          );
          if (successTag) {
            return successTag.value === trueBase64;
          }
          return false;
        });
        const height = parseInt(block.block.header.height);
        let requestsToHandleChallenge = [];
        let requestIdsToProcessUpdate = [];

        transactions.forEach((transaction) => {
          // TODO: clear key with smart-contract, eg. request_id or requestId
          const requestId =
            transaction.args.request_id || transaction.args.requestId;
          if (requestId == null) return;
          if (transaction.fnName === 'DeclareIdentityProof') {
            requestsToHandleChallenge.push({
              requestId,
              idpId: transaction.args.idp_id,
            });
          } else {
            requestIdsToProcessUpdate.push(requestId);
          }
        });
        requestIdsToProcessUpdate = [...new Set(requestIdsToProcessUpdate)];

        await Promise.all([
          ...requestsToHandleChallenge.map(({ requestId, idpId }) =>
            common.handleChallengeRequest(requestId + ':' + idpId)
          ),
          ...requestIdsToProcessUpdate.map(async (requestId) => {
            await processRequestUpdate(requestId, height);
            db.removeExpectedIdpResponseNodeIdInBlockList(height);
            db.removeExpectedDataSignInBlockList(height);
          }),
        ]);
      })
    );
  } catch (error) {
    const err = new CustomError({
      message: 'Error handling Tendermint NewBlock event',
      cause: error,
    });
    logger.error(err.getInfoForLog());
    await common.notifyError({
      callbackUrl: callbackUrls.error_url,
      action: 'handleTendermintNewBlockHeaderEvent',
      error: err,
    });
  }
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
    nodeIdList.map(async (asNodeId) => {
      try {
        //let nodeId = node.node_id;
        let mqAddress = await tendermintNdid.getMsqAddress(asNodeId);
        if (!mqAddress) return null;
        let { ip, port } = mqAddress;
        return {
          ip,
          port,
          ...(await tendermintNdid.getNodePubKey(asNodeId)),
        };
      } catch (error) {
        return null;
      }
    })
  )).filter((elem) => elem !== null);
  return receivers;
}

async function sendRequestToAS(requestData, height) {
  logger.debug({
    message: 'Sending request to AS',
    requestData,
    height,
  });

  let challenge = await db.getChallengeFromRequestId(requestData.request_id);
  if (requestData.data_request_list != undefined) {
    requestData.data_request_list.forEach(async (data_request) => {
      let receivers = await getASReceiverList(data_request);
      if (receivers.length === 0) {
        logger.error({
          message: 'No AS found',
          data_request,
        });
        return;
      }

      mq.send(receivers, {
        type: 'data_request',
        request_id: requestData.request_id,
        mode: requestData.mode,
        namespace: requestData.namespace,
        identifier: requestData.identifier,
        service_id: data_request.service_id,
        request_params: data_request.request_params,
        rp_id: requestData.rp_id,
        request_message: requestData.request_message,
        height,
        challenge,
        secretSalt: requestData.secretSalt,
        privateProofObjectList: requestData.privateProofObjectList,
      });
    });
  }
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

export async function handleMessageFromQueue(messageStr) {
  logger.info({
    message: 'Received message from MQ',
  });
  logger.debug({
    message: 'Message from MQ',
    messageStr,
  });
  let requestId;
  try {
    const message = JSON.parse(messageStr);
    requestId = message.request_id;

    const latestBlockHeight = tendermint.latestBlockHeight;

    logger.debug({
      message: 'Check height',
      wait: latestBlockHeight <= message.height,
    });

    if (message.type === 'idp_response') {
      //check accessor_id, undefined means mode 1
      if (message.accessor_id) {
        //store private parameter from EACH idp to request, to pass along to as
        let request = await db.getRequestData(message.request_id);
        //AS involve
        if (request) {
          if (request.privateProofObjectList) {
            request.privateProofObjectList.push({
              idp_id: message.idp_id,
              privateProofObject: {
                privateProofValue: message.privateProofValueArray,
                accessor_id: message.accessor_id,
                padding: message.padding,
              },
            });
          } else {
            request.privateProofObjectList = [
              {
                idp_id: message.idp_id,
                privateProofObject: {
                  privateProofValue: message.privateProofValueArray,
                  accessor_id: message.accessor_id,
                  padding: message.padding,
                },
              },
            ];
          }
          await db.setRequestData(message.request_id, request);
        }
      }

      //must wait for height
      const responseId = message.request_id + ':' + message.idp_id;

      if (latestBlockHeight <= message.height) {
        logger.debug({
          message: 'Saving message from MQ',
          tendermintLatestBlockHeight: latestBlockHeight,
          messageBlockHeight: message.height,
        });
        db.setPrivateProofReceivedFromMQ(responseId, message);
        db.addExpectedIdpResponseNodeIdInBlock(message.height, {
          requestId: message.request_id,
          idpId: message.idp_id,
        });
        return;
      }

      const callbackUrl = await db.getRequestCallbackUrl(message.request_id);
      // if (!callbackUrl) return;

      const requestDetail = await tendermintNdid.getRequestDetail({
        requestId: message.request_id,
        height: message.height,
      });

      const requestStatus = utils.getDetailedRequestStatus(requestDetail);

      const savedResponseValidList = await db.getIdpResponseValidList(
        message.request_id
      );

      const responseValid = await common.checkIdpResponse({
        requestStatus,
        idpId: message.idp_id,
        requestDataFromMq: message,
        responseIal: requestDetail.response_list.find(
          (response) => response.idp_id === message.idp_id
        ).ial,
      });

      const responseValidList = savedResponseValidList.concat([responseValid]);

      const eventDataForCallback = {
        type: 'request_status',
        ...requestStatus,
        response_valid_list: responseValidList,
        block_height: message.height,
      };

      await callbackToClient(callbackUrl, eventDataForCallback, true);

      if (isAllIdpRespondedAndValid({ requestStatus, responseValidList })) {
        const requestData = await db.getRequestData(message.request_id);
        if (requestData != null) {
          await sendRequestToAS(requestData, message.height);
        }
        db.removeChallengeFromRequestId(message.request_id);
      }
    } else if (message.type === 'challenge_request') {
      const responseId = message.request_id + ':' + message.idp_id;
      logger.debug({
        message: 'Save public proof from MQ',
        responseId,
        public_proof: message.public_proof,
      });
      db.setPublicProofReceivedFromMQ(responseId, message.public_proof);

      if (latestBlockHeight > message.height) {
        await common.handleChallengeRequest(
          message.request_id + ':' + message.idp_id
        );
        return;
      }
    } else if (message.type === 'as_data_response') {
      // Receive data from AS
      await db.addDataFromAS(message.request_id, {
        source_node_id: message.as_id,
        service_id: message.service_id,
        source_signature: message.signature,
        data: message.data,
      });

      const latestBlockHeight = tendermint.latestBlockHeight;
      if (latestBlockHeight <= message.height) {
        await db.addExpectedDataSignInBlock(message.height, {
          requestId: message.request_id,
          serviceId: message.service_id,
          asId: message.as_id,
        });
      } else {
        const signatureFromBlockchain = await tendermintNdid.getDataSignature({
          request_id: message.request_id,
          service_id: message.service_id,
          node_id: message.as_id,
        });

        if (signatureFromBlockchain == null) return;
        // TODO: if signature is invalid or mismatch then delete data from cache
        if (message.signature !== signatureFromBlockchain) return;
        if (
          !(await isDataSignatureValid(
            message.as_id,
            signatureFromBlockchain,
            message.data
          ))
        ) {
          return;
        }

        await tendermintNdid.setDataReceived({
          requestId: message.request_id,
          service_id: message.service_id,
          as_id: message.as_id,
        });
      }
    }
  } catch (error) {
    const err = new CustomError({
      message: 'Error handling message from message queue',
      cause: error,
    });
    logger.error(err.getInfoForLog());
    await common.notifyError({
      callbackUrl: callbackUrls.error_url,
      action: 'handleMessageFromQueue',
      error: err,
      requestId,
    });
  }
}

async function isDataSignatureValid(asNodeId, signature, data) {
  const publicKeyObj = await tendermintNdid.getNodePubKey(asNodeId);
  if (publicKeyObj == null) return;
  if (publicKeyObj.public_key == null) return;

  logger.debug({
    message: 'Verifying AS data signature',
    asNodeId,
    asNodePublicKey: publicKeyObj.public_key,
    signature,
    data,
  });
  if (
    !utils.verifySignature(
      signature,
      publicKeyObj.public_key,
      JSON.stringify(data)
    )
  ) {
    logger.warn({
      message: 'Data signature from AS is not valid',
      signature,
      asNodeId,
      asNodePublicKey: publicKeyObj.public_key,
    });
    return false;
  }
  return true;
}

async function checkAsDataSignaturesAndSetReceived(requestId, metadataList) {
  logger.debug({
    message: 'Check AS data signatures and set received (bulk)',
    requestId,
    metadataList,
  });

  const dataFromAS = await db.getDatafromAS(requestId);

  await Promise.all(
    metadataList.map(async ({ requestId, serviceId, asId }) => {
      const data = dataFromAS.find(
        (data) => data.service_id === serviceId && data.source_node_id === asId
      );
      if (data == null) return; // Have not received data from AS through message queue yet

      const signatureFromBlockchain = await tendermintNdid.getDataSignature({
        request_id: requestId,
        service_id: serviceId,
        node_id: asId,
      });
      if (signatureFromBlockchain == null) return;
      // TODO: if signature is invalid or mismatch then delete data from cache
      if (data.source_signature !== signatureFromBlockchain) return;
      if (
        !(await isDataSignatureValid(asId, signatureFromBlockchain, data.data))
      ) {
        return;
      }
      await tendermintNdid.setDataReceived({
        requestId,
        service_id: serviceId,
        as_id: asId,
      });
    })
  );
}
