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

import logger from '../../../logger';
import errorType from 'ndid-error/type';
import { getErrorObjectForClient } from '../../../utils/error';
import { env, clientHttpErrorCode, serverHttpErrorCode } from '../../../config';

export default function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let clientError;
  let unauthorizedError;
  if (err.name === 'CustomError') {
    clientError = err.isRootCauseClientError();
    if (err.getCode() === errorType.ABCI_UNAUTHORIZED.code) {
      unauthorizedError = true;
    }
  }

  const responseBody = {
    error: getErrorObjectForClient(err),
  };

  if (unauthorizedError) {
    res.status(403).json(responseBody);
    logger.error({
      message: 'Responded Unauthorized with HTTP code 403',
      responseBody,
    });
  } else if (clientError === true) {
    if (
      err.getCode() === errorType.QUERY_STRING_VALIDATION_FAILED.code ||
      err.getCode() === errorType.BODY_VALIDATION_FAILED.code
    ) {
      responseBody.details = err.details;
    }
    if (err.getCode() === errorType.DATA_VALIDATION_FAILED.code) {
      responseBody.details = err.getDetailsOfErrorWithCode();
    }
    res.status(clientHttpErrorCode).json(responseBody);
    logger.error({
      message: `Responded Bad Request with HTTP code ${clientHttpErrorCode}`,
      responseBody,
    });
  } else {
    res.status(serverHttpErrorCode).json(responseBody);
    logger.error({
      message: `Responded Internal Server Error with HTTP code ${serverHttpErrorCode}`,
      responseBody,
    });
  }
}

export function bodyParserErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let errorCode;
  let errorMessage;
  let clientError;
  if (err) {
    if (err.type == 'entity.parse.failed') {
      errorCode = errorType.BODY_PARSE_FAILED.code;
      errorMessage = errorType.BODY_PARSE_FAILED.message;
      clientError = true;
    } else if (err.type == 'entity.too.large') {
      errorCode = errorType.BODY_TOO_LARGE.code;
      errorMessage = errorType.BODY_TOO_LARGE.message;
      clientError = true;
    } else {
      errorCode = errorType.BODY_PARSER_ERROR.code;
      errorMessage = `${errorType.BODY_PARSER_ERROR.message}: ${err.message}`;
    }

    if (clientError) {
      const responseBody = {
        error: {
          code: errorCode,
          message: errorMessage,
        },
      };
      res.status(clientHttpErrorCode).json(responseBody);
      logger.error({
        message: `Responded Bad Request with HTTP code ${clientHttpErrorCode}`,
        responseBody,
      });
    } else {
      const responseBody = {
        error: {
          code: errorCode,
          message: errorMessage,
          stack: env === 'development' ? err.stack : undefined,
        },
      };
      res.status(serverHttpErrorCode).json(responseBody);
      logger.error({
        message: `Responded Internal Server Error with HTTP code ${serverHttpErrorCode}`,
        responseBody,
      });
    }
  }
}
