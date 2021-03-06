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
import crypto from 'crypto';
import constants from 'constants';

import bignum from 'bignum';

import * as cryptoUtils from './crypto';
import { parseKey, encodeSignature } from './asn1parser';
import * as nodeKey from './node_key';
import * as externalCryptoService from './external_crypto_service';

import CustomError from 'ndid-error/custom_error';
import errorType from 'ndid-error/type';

import logger from '../logger';

import * as config from '../config';

export function wait(ms, stoppable) {
  let setTimeoutFn;
  const promise = new Promise(
    (resolve) => (setTimeoutFn = setTimeout(resolve, ms))
  );
  if (stoppable) {
    return Object.assign(promise, { stop: () => clearTimeout(setTimeoutFn) });
  }
  return promise;
}

export function readFileAsync(path, opts) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, opts, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

export function randomBase64Bytes(length) {
  return cryptoUtils.randomBase64Bytes(length);
}

export function randomBufferBytes(length) {
  return crypto.randomBytes(length);
}

export function getNonce() {
  return randomBufferBytes(32);
}

export function hash(dataToHash) {
  const hashBuffer = cryptoUtils.sha256(dataToHash);
  return hashBuffer.toString('base64');
}

export async function decryptAsymetricKey(
  nodeId,
  encryptedSymKey,
  encryptedMessage
) {
  let symKeyBuffer;
  if (config.useExternalCryptoService) {
    symKeyBuffer = await externalCryptoService.decryptAsymetricKey(
      nodeId,
      encryptedSymKey.toString('base64')
    );
  } else {
    const key = nodeKey.getLocalNodePrivateKey(nodeId);
    const passphrase = nodeKey.getLocalNodePrivateKeyPassphrase(nodeId);
    symKeyBuffer = cryptoUtils.privateDecrypt(
      {
        key,
        passphrase,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      encryptedSymKey
    );
  }

  return cryptoUtils.decryptAES256GCM(symKeyBuffer, encryptedMessage, false);
}

export function encryptAsymetricKey(publicKey, messageBuffer) {
  const symKeyBuffer = crypto.randomBytes(32);
  const encryptedSymKey = cryptoUtils.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    symKeyBuffer
  );
  const encryptedMessage = cryptoUtils.encryptAES256GCM(
    symKeyBuffer,
    messageBuffer,
    false // Key derivation is not needed since key is cryptographically random generated and use only once
  );
  return {
    encryptedSymKey,
    encryptedMessage,
  };
}

export function extractPaddingFromPrivateEncrypt(cipher, publicKey) {
  let rawMessageBuffer;
  try {
    rawMessageBuffer = cryptoUtils.publicDecrypt(
      {
        key: publicKey,
        padding: constants.RSA_NO_PADDING,
      },
      Buffer.from(cipher, 'base64')
    );
  } catch (error) {
    throw new CustomError({
      errorType: errorType.INVALID_SECRET,
    });
  }

  //RSA PKCS v. 1.5
  if (
    rawMessageBuffer[0] !== 0 ||
    (rawMessageBuffer[1] !== 0 && rawMessageBuffer[1] !== 1)
  ) {
    throw new CustomError({
      errorType: errorType.INVALID_SECRET,
    });
  }
  let padLength = 2;
  while (rawMessageBuffer[padLength] !== 0) padLength++;

  logger.debug({
    message: 'padding extracted',
    publicKey,
    rawMessageBuffer,
    rawMessageString: rawMessageBuffer.toString('base64'),
    hash_id_string: rawMessageBuffer.slice(padLength).toString('base64'),
    padLength,
  });

  return rawMessageBuffer.slice(0, padLength + 1).toString('base64');
}

export function generatedChallenges(idp_count) {
  let challenges = [];
  let offset = 0;
  let longChallenge = randomBufferBytes(idp_count * 2 * config.challengeLength);

  for (let i = 0; i < idp_count; i++) {
    let startSecond = offset + config.challengeLength;
    let endSecond = startSecond + config.challengeLength;
    challenges.push([
      longChallenge.slice(offset, startSecond).toString('base64'),
      longChallenge.slice(startSecond, endSecond).toString('base64'),
    ]);
    offset = endSecond;
  }
  return challenges;
}

export function generatePublicProof(publicKey) {
  let { n, e } = extractParameterFromPublicKey(publicKey);
  let k = randomBase64Bytes(n.toBuffer().length - 1);
  let kInt = stringToBigInt(k);
  let blockchainProof = powerMod(kInt, e, n)
    .toBuffer()
    .toString('base64');
  return [k, blockchainProof];
}

export function generateIdentityProof(data) {
  logger.debug({
    message: 'Generating proof',
    data,
  });

  let signedHash = data.secret;
  if (signedHash == null) {
    throw new CustomError({
      errorType: errorType.MALFORMED_SECRET_FORMAT,
    });
  }
  let { n, e } = extractParameterFromPublicKey(data.publicKey);
  // -1 to garantee k < n
  let k = data.k; //randomBase64Bytes(n.toBuffer().length - 1);
  let kInt = stringToBigInt(k);
  let signedHashInt = stringToBigInt(signedHash);
  let challenge = stringToBigInt(data.challenge);

  let blockchainProof = powerMod(kInt, e, n)
    .toBuffer()
    .toString('base64');

  let privateProof = kInt
    .mul(powerMod(signedHashInt, challenge, n))
    .mod(n)
    .toBuffer()
    .toString('base64');

  let padding;
  try {
    padding = extractPaddingFromPrivateEncrypt(signedHash, data.publicKey);
  } catch (error) {
    throw error;
  }

  logger.debug({
    message: 'Proof generated',
    k: stringToBigInt(k),
    bcInt: stringToBigInt(blockchainProof),
    pvInt: stringToBigInt(privateProof),
    n,
    e,
    signedHashInt,
    challenge: stringToBigInt(data.challenge),
    padding,
    blockchainProof,
  });

  return {
    blockchainProof,
    privateProofValue: privateProof,
    padding,
  };
}

function extractParameterFromPublicKey(publicKey) {
  const parsedKey = parseKey(publicKey);
  return {
    n: stringToBigInt(parsedKey.data.modulus.toBuffer().toString('base64')),
    e: bignum(parsedKey.data.publicExponent.toString(10)),
  };
}

function powerMod(base, exponent, modulus) {
  return base.powm(exponent, modulus);
}

function stringToBigInt(string) {
  return bignum.fromBuffer(Buffer.from(string, 'base64'));
}

function euclideanGCD(a, b) {
  if (a.eq(bignum('0'))) return [b, bignum('0'), bignum('1')];
  let [g, y, x] = euclideanGCD(b.mod(a), a);
  return [
    g,
    x.sub(
      b
        .sub(b.mod(a))
        .div(a)
        .mul(y)
    ),
    y,
  ];
}

function moduloMultiplicativeInverse(a, modulo) {
  let [g, x, y] = euclideanGCD(a, modulo);
  if (!g.eq(1)) throw 'No modular inverse';
  return x.mod(modulo);
}
export function verifyZKProof(
  publicKey,
  challenges,
  privateProofArray,
  publicProofArray,
  sid,
  privateProofHash,
  padding
) {
  logger.debug({
    message: 'ZK List',
    publicKey,
    challenges,
    privateProofArray,
    publicProofArray,
    sid,
    privateProofHash,
    padding,
  });

  if (
    challenges.length !== privateProofArray.length ||
    challenges.length !== publicProofArray.length
  )
    return false;

  let result = hash(JSON.stringify(privateProofArray)) === privateProofHash;
  logger.debug({
    message: 'Check private proof hash',
    result,
  });
  for (let i = 0; i < challenges.length; i++) {
    logger.debug({
      message: 'should call zk',
      i,
    });
    result =
      result &&
      verifyZKProofSingle(
        publicKey,
        challenges[i],
        privateProofArray[i],
        publicProofArray[i],
        sid,
        //privateProofHash,
        padding
      );
    logger.debug({
      message: 'Loop ZK',
      i,
      result,
    });
  }
  return result;
}

function verifyZKProofSingle(
  publicKey,
  challenge,
  privateProof,
  publicProof,
  sid,
  //privateProofHash,
  padding
) {
  //if(privateProofHash !== hash(privateProof)) return false;

  let { n, e } = extractParameterFromPublicKey(publicKey);
  let hashedSid = hash(sid.namespace + ':' + sid.identifier);

  const sha256SignatureEncoded = encodeSignature(
    [2, 16, 840, 1, 101, 3, 4, 2, 1],
    Buffer.from(hashedSid, 'base64')
  );

  let paddedHashedSid = Buffer.concat([
    Buffer.from(padding, 'base64'),
    sha256SignatureEncoded,
  ]).toString('base64');

  let inverseHashSid = moduloMultiplicativeInverse(
    stringToBigInt(paddedHashedSid),
    n
  );
  if (inverseHashSid.lt(bignum(0))) inverseHashSid = inverseHashSid.add(n);

  let tmp1 = powerMod(stringToBigInt(privateProof), e, n);
  let tmp2 = powerMod(inverseHashSid, stringToBigInt(challenge), n);

  let tmp3 = tmp1.mul(tmp2).mod(n);

  logger.debug({
    message: 'ZK Verify result',
    hashBigInt: stringToBigInt(hashedSid),
    inverseHashSid,
    n,
    e,
    tmp1,
    tmp2,
    tmp3,
    publicProofBigInt: stringToBigInt(publicProof),
    publicProof,
    paddedHashedSid: stringToBigInt(paddedHashedSid),
    hashedSid,
    privateProof: stringToBigInt(privateProof),
  });

  return stringToBigInt(publicProof).eq(tmp3);
}

/**
 *
 * @param {string} messageToSign
 * @param {string} nodeId
 * @param {boolean} useMasterKey
 * @return {Buffer} signature
 */
export async function createSignature(messageToSign, nodeId, useMasterKey) {
  if (typeof messageToSign !== 'string') {
    throw new CustomError({
      message: 'Expected message to sign to be a string',
    });
  }
  const messageToSignHash = hash(messageToSign);

  if (config.useExternalCryptoService) {
    return await externalCryptoService.createSignature(
      messageToSign,
      messageToSignHash,
      nodeId,
      useMasterKey
    );
  }

  const key = useMasterKey
    ? nodeKey.getLocalNodeMasterPrivateKey(nodeId)
    : nodeKey.getLocalNodePrivateKey(nodeId);
  const passphrase = useMasterKey
    ? nodeKey.getLocalNodeMasterPrivateKeyPassphrase(nodeId)
    : nodeKey.getLocalNodePrivateKeyPassphrase(nodeId);

  return cryptoUtils.createSignature(messageToSign, {
    key,
    passphrase,
  });
}

export function verifySignature(signature, publicKey, plainText) {
  if (!Buffer.isBuffer(signature)) {
    signature = Buffer.from(signature, 'base64');
  }
  return cryptoUtils.verifySignature(signature, publicKey, plainText);
}

function generateCustomPadding(initialSalt, blockLength = 2048) {
  const hashLength = 256;
  const padLengthInbyte = parseInt(Math.floor((blockLength - hashLength) / 8));
  let paddingBuffer = Buffer.alloc(0);

  for (
    let i = 1;
    paddingBuffer.length + config.saltLength <= padLengthInbyte;
    i++
  ) {
    paddingBuffer = Buffer.concat([
      paddingBuffer,
      cryptoUtils
        .sha256(initialSalt + i.toString())
        .slice(0, config.saltLength),
    ]);
  }
  //set most significant bit to 0
  paddingBuffer[0] = paddingBuffer[0] & 0x7f;
  return paddingBuffer;
}

export function hashRequestMessageForConsent(
  request_message,
  initial_salt,
  request_id
) {
  const paddingBuffer = generateCustomPadding(initial_salt);
  const derivedSalt = cryptoUtils
    .sha256(request_id + initial_salt)
    .slice(0, config.saltLength)
    .toString('base64');

  const normalHashBuffer = cryptoUtils.sha256(request_message + derivedSalt);

  return Buffer.concat([paddingBuffer, normalHashBuffer]).toString('base64');
}

export function verifyResponseSignature(
  signature,
  publicKey,
  request_message,
  initial_salt,
  request_id
) {
  //should find block length if use another sign method
  const paddingBuffer = generateCustomPadding(initial_salt);
  const derivedSalt = cryptoUtils
    .sha256(request_id + initial_salt)
    .slice(0, config.saltLength)
    .toString('base64');

  const decryptedSignature = cryptoUtils
    .publicDecrypt(
      {
        key: publicKey,
        padding: constants.RSA_NO_PADDING,
      },
      Buffer.from(signature, 'base64')
    )
    .toString('base64');

  const paddedBase64 = Buffer.concat([
    paddingBuffer,
    cryptoUtils.sha256(request_message + derivedSalt),
  ]).toString('base64');

  return paddedBase64 === decryptedSignature;
}

export function createRequestId() {
  return cryptoUtils.randomHexBytes(32);
}

export function generateRequestMessageSalt(initial_salt) {
  const bufferHash = cryptoUtils.sha256(initial_salt);
  return bufferHash.slice(0, config.saltLength).toString('base64');
}

export function generateRequestParamSalt({
  request_id,
  service_id,
  initial_salt,
}) {
  const bufferHash = cryptoUtils.sha256(request_id + service_id + initial_salt);
  return bufferHash.slice(0, config.saltLength).toString('base64');
}

export function generateDataSalt({ request_id, service_id, initial_salt }) {
  const bufferHash = cryptoUtils.sha256(
    request_id + service_id + config.nodeId + initial_salt
  );
  return bufferHash.slice(0, config.saltLength).toString('base64');
}

/**
 * @typedef {Object} RequestStatus
 * @property {string} request_id
 * @property {string} status
 * @property {number} min_idp
 * @property {number} answered_idp_count
 * @property {boolean} closed
 * @property {boolean} timed_out
 * @property {Object} service_list
 * @property {string} service_list.service_id
 * @property {number} service_list.min_as
 * @property {number} service_list.signed_data_count
 * @property {number} service_list.received_data_count
 */
/**
 *
 * @param {Object} requestDetail
 * @param {string} requestDetail.request_id
 * @param {number} requestDetail.min_idp
 * @param {number} requestDetail.min_ial
 * @param {number} requestDetail.min_aal
 * @param {number} requestDetail.request_timeout
 * @param {Array.<Object>} requestDetail.data_request_list
 * @param {string} requestDetail.request_message_hash
 * @param {Array.<Object>} requestDetail.response_list
 * @param {boolean} requestDetail.closed
 * @param {boolean} requestDetail.timed_out
 * @returns {RequestStatus} requestStatus
 */
export function getDetailedRequestStatus(requestDetail) {
  if (requestDetail.data_request_list == null) {
    requestDetail.data_request_list = [];
  }
  if (requestDetail.response_list == null) {
    requestDetail.response_list = [];
  }

  let status;
  if (requestDetail.response_list.length === 0) {
    status = 'pending';
  }
  // Check response's status
  const responseCount = requestDetail.response_list.reduce(
    (count, response) => {
      if (response.status === 'accept') {
        count.accept++;
      } else if (response.status === 'reject') {
        count.reject++;
      }
      return count;
    },
    {
      accept: 0,
      reject: 0,
    }
  );
  if (responseCount.accept > 0 && responseCount.reject === 0) {
    status = 'confirmed';
  } else if (responseCount.accept === 0 && responseCount.reject > 0) {
    status = 'rejected';
  } else if (responseCount.accept > 0 && responseCount.reject > 0) {
    status = 'complicated';
  }

  const serviceList = requestDetail.data_request_list.map((service) => {
    const signedAnswerCount =
      service.answered_as_id_list != null
        ? service.answered_as_id_list.length
        : 0;
    const receivedDataCount =
      service.received_data_from_list != null
        ? service.received_data_from_list.length
        : 0;
    return {
      service_id: service.service_id,
      min_as: service.min_as,
      signed_data_count: signedAnswerCount,
      received_data_count: receivedDataCount,
    };
  });

  if (requestDetail.data_request_list.length === 0) {
    // No data request
    if (requestDetail.response_list.length === requestDetail.min_idp) {
      if (
        responseCount.reject === 0 &&
        (responseCount.accept > 0 ||
          (responseCount.accept === 0 &&
            requestDetail.purpose === 'AddAccessor'))
      ) {
        status = 'completed';
      }
    }
  } else if (requestDetail.data_request_list.length > 0) {
    const asSignedAnswerCount = serviceList.reduce(
      (total, service) => ({
        count: total.count + service.min_as,
        signedAnswerCount: total.signedAnswerCount + service.signed_data_count,
        receivedDataCount:
          total.receivedDataCount + service.received_data_count,
      }),
      {
        count: 0,
        signedAnswerCount: 0,
        receivedDataCount: 0,
      }
    );

    if (
      asSignedAnswerCount.count === asSignedAnswerCount.signedAnswerCount &&
      asSignedAnswerCount.signedAnswerCount ===
        asSignedAnswerCount.receivedDataCount
    ) {
      status = 'completed';
    }
  }
  return {
    mode: requestDetail.mode,
    request_id: requestDetail.request_id,
    status,
    min_idp: requestDetail.min_idp,
    answered_idp_count: requestDetail.response_list.length,
    closed: requestDetail.closed,
    timed_out: requestDetail.timed_out,
    service_list: serviceList,
  };
}
