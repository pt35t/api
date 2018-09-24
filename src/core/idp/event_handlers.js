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

import { callbackUrls, processMessage } from '.';
import { createResponse } from './create_response';

import { callbackToClient } from '../../utils/callback';
import CustomError from '../../error/custom_error';
import { getErrorObjectForClient } from '../../error/helpers';
import logger from '../../logger';

import * as tendermint from '../../tendermint';
import * as common from '../common';
import * as cacheDb from '../../db/cache';
import privateMessageType from '../private_message_type';

import * as config from '../../config';

const requestIdLocks = {};

export async function handleMessageFromQueue(message, nodeId = config.nodeId) {
  logger.info({
    message: 'Received message from MQ',
    nodeId,
  });
  logger.debug({
    message: 'Message from MQ',
    messageJSON: message,
  });

  const requestId = message.request_id;
  try {
    //if message is challenge for response, no need to wait for blockchain
    if (message.type === privateMessageType.CHALLENGE_RESPONSE) {
      //store challenge
      const createResponseParams = await cacheDb.getResponseFromRequestId(
        nodeId,
        message.request_id
      );
      try {
        let request = await cacheDb.getRequestReceivedFromMQ(
          nodeId,
          message.request_id
        );
        request.challenge = message.challenge;
        logger.debug({
          message: 'Save challenge to request',
          request,
          challenge: message.challenge,
        });
        await cacheDb.setRequestReceivedFromMQ(
          nodeId,
          message.request_id,
          request
        );
        //query reponse data
        logger.debug({
          message: 'Data to response',
          createResponseParams,
        });
        await createResponse(createResponseParams, { nodeId });
      } catch (error) {
        await callbackToClient(
          createResponseParams.callback_url,
          {
            node_id: nodeId,
            type: 'response_result',
            success: false,
            reference_id: createResponseParams.reference_id,
            request_id: createResponseParams.request_id,
            error: getErrorObjectForClient(error),
          },
          true
        );
        cacheDb.removeResponseFromRequestId(
          nodeId,
          createResponseParams.request_id
        );
      }
      return;
    } else {
      if (message.type === privateMessageType.CONSENT_REQUEST) {
        await Promise.all([
          cacheDb.setRequestReceivedFromMQ(nodeId, message.request_id, message),
          cacheDb.setRPIdFromRequestId(
            nodeId,
            message.request_id,
            message.rp_id
          ),
        ]);

        const latestBlockHeight = tendermint.latestBlockHeight;
        if (latestBlockHeight <= message.height) {
          logger.debug({
            message: 'Saving consent request message from MQ',
            tendermintLatestBlockHeight: latestBlockHeight,
            messageBlockHeight: message.height,
          });
          requestIdLocks[nodeId + ':' + message.request_id] = true;
          await Promise.all([
            cacheDb.setRequestToProcessReceivedFromMQ(
              nodeId,
              message.request_id,
              message
            ),
            cacheDb.addRequestIdExpectedInBlock(
              nodeId,
              message.height,
              message.request_id
            ),
          ]);
          if (tendermint.latestBlockHeight <= message.height) {
            delete requestIdLocks[nodeId + ':' + message.request_id];
            return;
          } else {
            await cacheDb.removeRequestToProcessReceivedFromMQ(
              nodeId,
              message.request_id
            );
          }
        }
      } else if (message.type === privateMessageType.CHALLENGE_REQUEST) {
        const latestBlockHeight = tendermint.latestBlockHeight;
        if (latestBlockHeight <= message.height) {
          logger.debug({
            message: 'Saving challege request message from MQ',
            tendermintLatestBlockHeight: latestBlockHeight,
            messageBlockHeight: message.height,
          });
          const responseId =
            nodeId + ':' + message.request_id + ':' + message.idp_id;
          requestIdLocks[nodeId + ':' + message.request_id] = true;
          await Promise.all([
            cacheDb.setRequestToProcessReceivedFromMQ(
              nodeId,
              message.request_id,
              message
            ),
            cacheDb.addRequestIdExpectedInBlock(
              nodeId,
              message.height,
              message.request_id
            ),
            cacheDb.setPublicProofReceivedFromMQ(
              nodeId,
              responseId,
              message.public_proof
            ),
          ]);
          if (tendermint.latestBlockHeight <= message.height) {
            delete requestIdLocks[nodeId + ':' + message.request_id];
            return;
          } else {
            await Promise.all([
              cacheDb.removeRequestToProcessReceivedFromMQ(
                nodeId,
                message.request_id
              ),
              cacheDb.removePublicProofReceivedFromMQ(nodeId, responseId),
            ]);
          }
        }
      } else if (message.type === privateMessageType.IDP_RESPONSE) {
        const request = await cacheDb.getRequestData(
          nodeId,
          message.request_id
        );
        if (request) {
          if (request.privateProofObjectList) {
            request.privateProofObjectList.push({
              idp_id: message.idp_id,
              privateProofObject: {
                privateProofValue: message.privateProofValue,
                accessor_id: message.accessor_id,
                padding: message.padding,
              },
            });
          } else {
            request.privateProofObjectList = [
              {
                idp_id: message.idp_id,
                privateProofObject: {
                  privateProofValue: message.privateProofValue,
                  accessor_id: message.accessor_id,
                  padding: message.padding,
                },
              },
            ];
          }
          await cacheDb.setRequestData(nodeId, message.request_id, request);
        }

        const latestBlockHeight = tendermint.latestBlockHeight;
        if (latestBlockHeight <= message.height) {
          logger.debug({
            message: 'Saving IdP response message from MQ',
            tendermintLatestBlockHeight: latestBlockHeight,
            messageBlockHeight: message.height,
          });
          requestIdLocks[nodeId + ':' + message.request_id] = true;
          await Promise.all([
            cacheDb.setRequestToProcessReceivedFromMQ(
              nodeId,
              message.request_id,
              message
            ),
            cacheDb.addRequestIdExpectedInBlock(
              nodeId,
              message.height,
              message.request_id
            ),
          ]);
          if (tendermint.latestBlockHeight <= message.height) {
            delete requestIdLocks[nodeId + ':' + message.request_id];
            return;
          } else {
            await cacheDb.removeRequestToProcessReceivedFromMQ(
              nodeId,
              message.request_id
            );
          }
        }
      }
    }

    await processMessage(nodeId, message);
    delete requestIdLocks[nodeId + ':' + message.request_id];
  } catch (error) {
    const err = new CustomError({
      message: 'Error handling message from message queue',
      cause: error,
    });
    logger.error(err.getInfoForLog());
    await common.notifyError({
      nodeId,
      callbackUrl: callbackUrls.error_url,
      action: 'handleMessageFromQueue',
      error: err,
      requestId,
    });
  }
}

export async function handleTendermintNewBlock(
  fromHeight,
  toHeight,
  parsedTransactionsInBlocks,
  nodeId = config.nodeId
) {
  logger.debug({
    message: 'Handling Tendermint new blocks',
    nodeId,
    fromHeight,
    toHeight,
  });

  try {
    await Promise.all([
      processMessageExptectedInBlocks(fromHeight, toHeight, nodeId),
      processTasksInBlocks(parsedTransactionsInBlocks, nodeId),
    ]);
  } catch (error) {
    const err = new CustomError({
      message: 'Error handling Tendermint NewBlock event',
      cause: error,
    });
    logger.error(err.getInfoForLog());
    await common.notifyError({
      nodeId,
      callbackUrl: callbackUrls.error_url,
      action: 'handleTendermintNewBlock',
      error: err,
    });
  }
}

async function processMessageExptectedInBlocks(fromHeight, toHeight, nodeId) {
  const requestIdsInTendermintBlock = await cacheDb.getRequestIdsExpectedInBlock(
    nodeId,
    fromHeight,
    toHeight
  );
  await Promise.all(
    requestIdsInTendermintBlock.map(async (requestId) => {
      if (requestIdLocks[nodeId + ':' + requestId]) return;
      const message = await cacheDb.getRequestToProcessReceivedFromMQ(
        nodeId,
        requestId
      );
      if (message == null) return;
      await processMessage(nodeId, message);
      await cacheDb.removeRequestToProcessReceivedFromMQ(nodeId, requestId);
    })
  );
  cacheDb.removeRequestIdsExpectedInBlock(nodeId, fromHeight, toHeight);
}

async function processTasksInBlocks(parsedTransactionsInBlocks, nodeId) {
  const transactionsInBlocksToProcess = parsedTransactionsInBlocks.filter(
    ({ transactions }) => transactions.length >= 0
  );

  await Promise.all(
    transactionsInBlocksToProcess.map(async ({ transactions }) => {
      // Clean up closed or timed out create identity requests
      const requestIdsToCleanUpSet = new Set();
      transactions.forEach((transaction) => {
        const requestId = transaction.args.request_id;
        if (requestId == null) return;
        if (
          transaction.fnName === 'CloseRequest' ||
          transaction.fnName === 'TimeOutRequest'
        ) {
          requestIdsToCleanUpSet.add(requestId);
        }
      });
      const requestIdsToCleanUp = [...requestIdsToCleanUpSet];

      await Promise.all(
        requestIdsToCleanUp.map(async (requestId) => {
          const callbackUrl = await cacheDb.getRequestCallbackUrl(
            nodeId,
            requestId
          );
          if (!callbackUrl) return;

          const referenceId = await cacheDb.getReferenceIdByRequestId(
            nodeId,
            requestId
          );
          await Promise.all([
            cacheDb.removeRequestCallbackUrl(nodeId, requestId),
            cacheDb.removeRequestIdByReferenceId(nodeId, referenceId),
            cacheDb.removeReferenceIdByRequestId(nodeId, requestId),
            cacheDb.removeRequestData(nodeId, requestId),
            cacheDb.removeIdpResponseValidList(nodeId, requestId),
            cacheDb.removeTimeoutScheduler(nodeId, requestId),
          ]);
        })
      );
    })
  );
}
