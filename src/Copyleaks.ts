/*
 The MIT License(MIT)

 Copyright(c) 2016 Copyleaks LTD (https://copyleaks.com)

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
*/
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

import { CopyleaksConfig } from './app.config';
import { UnderMaintenanceException, CommandException, AuthExipredException, RateLimitException } from './models/exceptions';
import { CopyleaksExportModel } from './models/exports';
import { CopyleaksDeleteRequestModel } from './models/request';
import { CopyleaksStartRequestModel } from './models/request/CopyleaksStartRequestModel';
import { CopyleaksAuthToken } from './models/response';
import { CopyleaksFileOcrSubmissionModel, CopyleaksFileSubmissionModel, CopyleaksURLSubmissionModel } from './models/submissions';
import { isRateLimitResponse, isSuccessStatusCode, isUnderMaintenanceResponse } from './utils';

export class Copyleaks {
  private api: AxiosInstance;
  private accountApi: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: `${CopyleaksConfig.API_SERVER_URI}`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': CopyleaksConfig.USER_AGENT,
      }
    });

    this.accountApi = axios.create({
      baseURL: `${CopyleaksConfig.IDENTITY_SERVER_URI}`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': CopyleaksConfig.USER_AGENT,
      }
    })
  }

  /**
   * Login to Copyleaks authentication server.
   * For more info: https://api.copyleaks.com/documentation/v3/account/login.
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param email Copyleaks account email address.
   * @param key Copyleaks account secret key.
   * @returns A authentication token that being expired after certain amount of time.
   */
  public async loginAsync(email: string, key: string) {
    // missing args check

    const payload = {
      email,
      key
    }
    const response = await this.request({
      method: 'POST',
      url: `/v3/account/login/api`,
      data: payload,
    }, this.accountApi);

    if (isSuccessStatusCode(response.status)) {
      return response.data;
    } else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException();
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Verify that Copyleaks authentication token is exists and not exipired.
   * * Exceptions:
   *  * AuthExipredException: authentication expired. Need to login again.
   * @param authToken Copyleaks authentication token
   */
  public verifyAuthToken(authToken: CopyleaksAuthToken, timeUntilExpiry: number = 5) {

    const date = new Date(Date.now());
    date.setMinutes(date.getMinutes() + timeUntilExpiry); // adds 5 minutes ahead for a safety shield.

    const expiresDate = new Date(authToken['.expires']);

    if (expiresDate.getTime() <= date.getTime()) {
      throw new AuthExipredException(); // expired
    }
  }

  /**
   * Starting a new process by providing a file to scan.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/submit/file
   * https://api.copyleaks.com/documentation/v3/businesses/submit/file
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token
   * @param scanId Attach your own scan Id
   * @param submission Submission properties
   */
  public async submitFileAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, scanId: string, submission: CopyleaksFileSubmissionModel) {
    this.verifyAuthToken(authToken);

    let response
    try {
      response = await this.request({
        method: 'PUT',
        url: `/v3/${product}/submit/file/${scanId}`,
        data: submission,
        headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
        maxBodyLength: Infinity
      });
    }
    catch(error) {
      throw new Error(`Failed to submit file to Copyleaks API for scan with ID '${scanId}'.`, { cause: error });
    }
    if (isSuccessStatusCode(response.status))
      return; // Completed successfully
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else {
      throw new CommandException(response)
    }
  }

  private async request(config: AxiosRequestConfig, requester: AxiosInstance = this.api, retries: number = 10, backoff: number = 2000): Promise<any> {
    try {
      return await requester(config);
    }
    catch(error: any) {
      console.log('copyleaks request error', error.response && error.response.status, { retries, backoff });
      if(retries < 1) {
        throw error;
      }
      if(error.response && ([ 429, 500, 502 ].includes(error.response.status) || error.code === 'ETIMEDOUT')) {
        console.log('copyleaks backoff', JSON.stringify(config));
        await new Promise((resolve) => setTimeout(resolve, backoff));
        return await this.request(config, requester, retries - 1, backoff * 2);
      }
      throw error;
    }
  }

  /**
   * Starting a new process by providing a OCR image file to scan.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/submit/ocr
   * https://api.copyleaks.com/documentation/v3/businesses/submit/ocr
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token
   * @param scanId Attach your own scan Id
   * @param submission Submission properties
   */
  public async submitFileOcrAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, scanId: string, submission: CopyleaksFileOcrSubmissionModel) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'PUT',
      url: `/v3/${product}/submit/ocr/${scanId}`,
      data: submission,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
      maxBodyLength: Infinity
    });
    if (isSuccessStatusCode(response.status))
      return; // Completed successfully
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Starting a new process by providing a URL to scan.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/submit/url
   * https://api.copyleaks.com/documentation/v3/businesses/submit/url
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token
   * @param scanId Attach your own scan Id
   * @param submission Submission properties
   */
  public async submitUrlAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, scanId: string, submission: CopyleaksURLSubmissionModel) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'PUT',
      url: `/v3/${product}/submit/url/${scanId}`,
      data: submission,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
      maxBodyLength: Infinity
    });
    if (isSuccessStatusCode(response.status))
      return; // Completed successfully
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Exporting scans artifact into your server.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/downloads/export
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param authToken Your login token to Copyleaks server
   * @param scanId The scan ID of the specific scan to export.
   * @param exportId A new Id for the export process.
   * @param model Request of which artifact should be exported.
   */
  public async exportAsync(authToken: CopyleaksAuthToken, scanId: string, exportId: string, model: CopyleaksExportModel) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'POST',
      url: `/v3/downloads/${scanId}/export/${exportId}`,
      data: model,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
      maxBodyLength: Infinity
    });
    if (isSuccessStatusCode(response.status)) {
      return; // Completed successfully
    } else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException();
    } else {
      throw new CommandException(response);
    }
  }

  /**
   * Start scanning all the files you submitted for a price-check.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/start
   * https://api.copyleaks.com/documentation/v3/businesses/start
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param product Which product (education or business) is being use.
   * @param authToken Your login token to Copyleaks server.
   * @param model Include information about which scans should be started.
   */
  public async startAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, model: CopyleaksStartRequestModel) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'PATCH',
      url: `/v3/${product}/start`,
      data: model,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
      maxBodyLength: Infinity
    });
    if (isSuccessStatusCode(response.status)) {
      return response.data; // Completed successfully
    } else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException();
    } else {
      throw new CommandException(response);
    }
  }

  /**
   * Delete the specific process from the server.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/delete
   * https://api.copyleaks.com/documentation/v3/businesses/delete
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token
   * @param payloads
   */
  public async deleteAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, payloads: CopyleaksDeleteRequestModel) {

    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'PATCH',
      url: `/v3.1/${product}/delete`,
      data: payloads,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
      maxBodyLength: Infinity
    });
    if (isSuccessStatusCode(response.status))
      return; // Completed successfully;
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else if (isRateLimitResponse(response.status)) {
      throw new RateLimitException();
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Resend status webhooks for existing scans.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/webhook-resend
   * https://api.copyleaks.com/documentation/v3/businesses/webhook-resend
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token
   * @param scanId Copyleaks scan Id
   */
  public async resendWebhookAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, scanId: string) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'POST',
      url: `/v3/${product}/scans/${scanId}/webhooks/resend`,
      data: null,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
    });
    if (isSuccessStatusCode(response.status))
      return;  // Completed successfully
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Get current credits balance for the Copyleaks account.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/credits
   * https://api.copyleaks.com/documentation/v3/businesses/credits
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   *  * RateLimitException: Too many requests. Please wait before calling again.
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token
   */
  public async getCreditsBalanceAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'GET',
      url: `/v3/${product}/credits`,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
    });
    if (isSuccessStatusCode(response.status))
      return response.data;
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else if (isRateLimitResponse(response.status)) {
      throw new RateLimitException();
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * This endpoint allows you to export your usage history between two dates.
   * The output results will be exported to a csv file and it will be attached to the response.
   * For more info:
   * https://api.copyleaks.com/documentation/v3/education/usages/history
   * https://api.copyleaks.com/documentation/v3/businesses/usages/history
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   *  * RateLimitException: Too many requests. Please wait before calling again.
   * @param product Which product (education or business) is being use.
   * @param authToken Copyleaks authentication token.
   * @param startDate The start date to collect usage history from. Date Format: `dd-MM-yyyy`.
   * @param endDate The end date to collect usage history from. Date Format: `dd-MM-yyyy`.
   */
  public async getUsagesHistoryCsvAsync(product: 'education' | 'businesses', authToken: CopyleaksAuthToken, startDate: string, endDate: string) {
    this.verifyAuthToken(authToken);

    const response = await this.request({
      method: 'GET',
      url: `/v3/${product}/usages/history?start=${startDate}&end=${endDate}`,
      headers: { 'Authorization': `Bearer ${authToken['access_token']}` },
    });
    if (isSuccessStatusCode(response.status))
      return response.data;
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else if (isRateLimitResponse(response.status)) {
      throw new RateLimitException();
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Get updates about copyleaks api release notes.
   * For more info: https://api.copyleaks.com/documentation/v3/release-notes
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   *  * RateLimitException: Too many requests. Please wait before calling again.
   * @returns List of release notes.
   */
  public async getReleaseNotesAsync() {
    const response = await this.request({
      method: 'GET',
      url: `/v3/release-logs.json`,
    });
    if (isSuccessStatusCode(response.status))
      return response.data;
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else if (isRateLimitResponse(response.status)) {
      throw new RateLimitException();
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Get a list of the supported file types.
   * For more info: https://api.copyleaks.com/documentation/v3/specifications/supported-file-types
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   *  * RateLimitException: Too many requests. Please wait before calling again.
   * @returns List of supported file types.
   */
  public async getSupportedFileTypesAsync() {
    const response = await this.request({
      method: 'GET',
      url: `/v3/miscellaneous/supported-file-types`,
    });
    if (isSuccessStatusCode(response.status))
      return response.data;
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else if (isRateLimitResponse(response.status)) {
      throw new RateLimitException();
    } else {
      throw new CommandException(response)
    }
  }

  /**
   * Get a list of the supported languages for OCR (this is not a list of supported languages for the api, but only for the OCR files scan).
   * For more info: https://api.copyleaks.com/documentation/v3/specifications/ocr-languages/list
   * * Exceptions:
   *  * CommandExceptions: Server reject the request. See response status code,
   *     headers and content for more info.
   *  * UnderMaintenanceException: Copyleaks servers are unavailable for maintenance.
   *     We recommend to implement exponential backoff algorithm as described here:
   *     https://api.copyleaks.com/documentation/v3/exponential-backoff
   *  * RateLimitException: Too many requests. Please wait before calling again.
   * @returns List of supported OCR languages.
   */
  public async getOCRSupportedLanguagesAsync() {
    const response = await this.request({
      method: 'GET',
      url: `/v3/miscellaneous/ocr-languages-list`,
    });
    if (isSuccessStatusCode(response.status))
      return response.data;
    else if (isUnderMaintenanceResponse(response.status)) {
      throw new UnderMaintenanceException()
    } else if (isRateLimitResponse(response.status)) {
      throw new RateLimitException();
    } else {
      throw new CommandException(response)
    }
  }
}
