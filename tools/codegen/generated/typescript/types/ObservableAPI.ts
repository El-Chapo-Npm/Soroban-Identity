import { ResponseContext, RequestContext, HttpFile, HttpInfo } from '../http/http';
import { Configuration, ConfigurationOptions, mergeConfiguration } from '../configuration'
import type { Middleware } from '../middleware';
import { Observable, of, from } from '../rxjsStub';
import {mergeMap, map} from  '../rxjsStub';
import { Credential } from '../models/Credential';
import { CredentialRevokeResponse } from '../models/CredentialRevokeResponse';
import { CredentialVerifyResponse } from '../models/CredentialVerifyResponse';
import { DeleteWebhook200Response } from '../models/DeleteWebhook200Response';
import { ErrorResponse } from '../models/ErrorResponse';
import { ErrorResponseDetailsInner } from '../models/ErrorResponseDetailsInner';
import { ExecuteBatch200Response } from '../models/ExecuteBatch200Response';
import { ExecuteBatch200ResponseResultsInner } from '../models/ExecuteBatch200ResponseResultsInner';
import { ExecuteBatch200ResponseSummary } from '../models/ExecuteBatch200ResponseSummary';
import { ExecuteBatchRequest } from '../models/ExecuteBatchRequest';
import { ExecuteBatchRequestOperationsInner } from '../models/ExecuteBatchRequestOperationsInner';
import { GetQuota200Response } from '../models/GetQuota200Response';
import { GetQuota200ResponseDaily } from '../models/GetQuota200ResponseDaily';
import { GetQuota200ResponseMonthly } from '../models/GetQuota200ResponseMonthly';
import { GraphqlPost200Response } from '../models/GraphqlPost200Response';
import { GraphqlPostRequest } from '../models/GraphqlPostRequest';
import { HealthResponse } from '../models/HealthResponse';
import { IssueCredentialRequest } from '../models/IssueCredentialRequest';
import { ListWebhookLogs200Response } from '../models/ListWebhookLogs200Response';
import { ListWebhooks200Response } from '../models/ListWebhooks200Response';
import { OauthIntrospect200Response } from '../models/OauthIntrospect200Response';
import { OauthIntrospectRequest } from '../models/OauthIntrospectRequest';
import { OauthRevoke200Response } from '../models/OauthRevoke200Response';
import { OauthToken200Response } from '../models/OauthToken200Response';
import { OauthTokenRequest } from '../models/OauthTokenRequest';
import { PaginatedCredentials } from '../models/PaginatedCredentials';
import { PollEvents200Response } from '../models/PollEvents200Response';
import { RegisterOauthClient201Response } from '../models/RegisterOauthClient201Response';
import { RegisterOauthClientRequest } from '../models/RegisterOauthClientRequest';
import { RegisterWebhookRequest } from '../models/RegisterWebhookRequest';
import { ResolveDid200Response } from '../models/ResolveDid200Response';
import { ServerInfo } from '../models/ServerInfo';
import { VerifyCredentialsBatch200Response } from '../models/VerifyCredentialsBatch200Response';
import { VerifyCredentialsBatch200ResponseResultsInner } from '../models/VerifyCredentialsBatch200ResponseResultsInner';
import { VerifyCredentialsBatchRequest } from '../models/VerifyCredentialsBatchRequest';
import { Webhook } from '../models/Webhook';
import { WebhookLog } from '../models/WebhookLog';

import { CredentialsApiRequestFactory, CredentialsApiResponseProcessor} from "../apis/CredentialsApi";
export class ObservableCredentialsApi {
    private requestFactory: CredentialsApiRequestFactory;
    private responseProcessor: CredentialsApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: CredentialsApiRequestFactory,
        responseProcessor?: CredentialsApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new CredentialsApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new CredentialsApiResponseProcessor();
    }

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param id Unique identifier of the credential
     * @param [ifMatch] Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag.
     */
    public deleteCredentialWithHttpInfo(id: string, ifMatch?: string, _options?: ConfigurationOptions): Observable<HttpInfo<CredentialRevokeResponse>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.deleteCredential(id, ifMatch, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.deleteCredentialWithHttpInfo(rsp)));
            }));
    }

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param id Unique identifier of the credential
     * @param [ifMatch] Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag.
     */
    public deleteCredential(id: string, ifMatch?: string, _options?: ConfigurationOptions): Observable<CredentialRevokeResponse> {
        return this.deleteCredentialWithHttpInfo(id, ifMatch, _options).pipe(map((apiResponse: HttpInfo<CredentialRevokeResponse>) => apiResponse.data));
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param id
     */
    public deleteCredentialRevocationWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<CredentialRevokeResponse>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.deleteCredentialRevocation(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.deleteCredentialRevocationWithHttpInfo(rsp)));
            }));
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param id
     */
    public deleteCredentialRevocation(id: string, _options?: ConfigurationOptions): Observable<CredentialRevokeResponse> {
        return this.deleteCredentialRevocationWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<CredentialRevokeResponse>) => apiResponse.data));
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param id Unique identifier of the credential
     * @param [fields] Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects.
     * @param [ifNoneMatch] Conditional GET. When it matches the current strong ETag, the server returns 304 with no body.
     */
    public getCredentialWithHttpInfo(id: string, fields?: string, ifNoneMatch?: string, _options?: ConfigurationOptions): Observable<HttpInfo<Credential>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getCredential(id, fields, ifNoneMatch, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getCredentialWithHttpInfo(rsp)));
            }));
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param id Unique identifier of the credential
     * @param [fields] Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects.
     * @param [ifNoneMatch] Conditional GET. When it matches the current strong ETag, the server returns 304 with no body.
     */
    public getCredential(id: string, fields?: string, ifNoneMatch?: string, _options?: ConfigurationOptions): Observable<Credential> {
        return this.getCredentialWithHttpInfo(id, fields, ifNoneMatch, _options).pipe(map((apiResponse: HttpInfo<Credential>) => apiResponse.data));
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param issueCredentialRequest
     */
    public issueCredentialWithHttpInfo(issueCredentialRequest: IssueCredentialRequest, _options?: ConfigurationOptions): Observable<HttpInfo<Credential>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.issueCredential(issueCredentialRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.issueCredentialWithHttpInfo(rsp)));
            }));
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param issueCredentialRequest
     */
    public issueCredential(issueCredentialRequest: IssueCredentialRequest, _options?: ConfigurationOptions): Observable<Credential> {
        return this.issueCredentialWithHttpInfo(issueCredentialRequest, _options).pipe(map((apiResponse: HttpInfo<Credential>) => apiResponse.data));
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param issueCredentialRequest
     */
    public issueCredentialAliasWithHttpInfo(issueCredentialRequest: IssueCredentialRequest, _options?: ConfigurationOptions): Observable<HttpInfo<Credential>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.issueCredentialAlias(issueCredentialRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.issueCredentialAliasWithHttpInfo(rsp)));
            }));
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param issueCredentialRequest
     */
    public issueCredentialAlias(issueCredentialRequest: IssueCredentialRequest, _options?: ConfigurationOptions): Observable<Credential> {
        return this.issueCredentialAliasWithHttpInfo(issueCredentialRequest, _options).pipe(map((apiResponse: HttpInfo<Credential>) => apiResponse.data));
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param [limit] Number of records to return (max 200)
     * @param [cursor] Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor
     * @param [direction] Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order.
     * @param [fields] Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object.
     */
    public listCredentialsWithHttpInfo(limit?: number, cursor?: string, direction?: 'next' | 'prev', fields?: string, _options?: ConfigurationOptions): Observable<HttpInfo<PaginatedCredentials>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.listCredentials(limit, cursor, direction, fields, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.listCredentialsWithHttpInfo(rsp)));
            }));
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param [limit] Number of records to return (max 200)
     * @param [cursor] Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor
     * @param [direction] Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order.
     * @param [fields] Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object.
     */
    public listCredentials(limit?: number, cursor?: string, direction?: 'next' | 'prev', fields?: string, _options?: ConfigurationOptions): Observable<PaginatedCredentials> {
        return this.listCredentialsWithHttpInfo(limit, cursor, direction, fields, _options).pipe(map((apiResponse: HttpInfo<PaginatedCredentials>) => apiResponse.data));
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param id
     */
    public revokeCredentialWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<CredentialRevokeResponse>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.revokeCredential(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.revokeCredentialWithHttpInfo(rsp)));
            }));
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param id
     */
    public revokeCredential(id: string, _options?: ConfigurationOptions): Observable<CredentialRevokeResponse> {
        return this.revokeCredentialWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<CredentialRevokeResponse>) => apiResponse.data));
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param id Identifier of the credential to verify
     */
    public verifyCredentialWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<CredentialVerifyResponse>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.verifyCredential(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.verifyCredentialWithHttpInfo(rsp)));
            }));
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param id Identifier of the credential to verify
     */
    public verifyCredential(id: string, _options?: ConfigurationOptions): Observable<CredentialVerifyResponse> {
        return this.verifyCredentialWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<CredentialVerifyResponse>) => apiResponse.data));
    }

}

import { DefaultApiRequestFactory, DefaultApiResponseProcessor} from "../apis/DefaultApi";
export class ObservableDefaultApi {
    private requestFactory: DefaultApiRequestFactory;
    private responseProcessor: DefaultApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: DefaultApiRequestFactory,
        responseProcessor?: DefaultApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new DefaultApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new DefaultApiResponseProcessor();
    }

    /**
     * Issue an API key with configurable permissions and subscription tier.
     * Issue a new API key
     */
    public createApiKeyWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.createApiKey(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.createApiKeyWithHttpInfo(rsp)));
            }));
    }

    /**
     * Issue an API key with configurable permissions and subscription tier.
     * Issue a new API key
     */
    public createApiKey(_options?: ConfigurationOptions): Observable<void> {
        return this.createApiKeyWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Revoke an API key
     * @param id
     */
    public deleteApiKeyWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.deleteApiKey(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.deleteApiKeyWithHttpInfo(rsp)));
            }));
    }

    /**
     * Revoke an API key
     * @param id
     */
    public deleteApiKey(id: string, _options?: ConfigurationOptions): Observable<void> {
        return this.deleteApiKeyWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.
     * Execute multiple credential operations in one request (#749)
     * @param executeBatchRequest
     */
    public executeBatchWithHttpInfo(executeBatchRequest: ExecuteBatchRequest, _options?: ConfigurationOptions): Observable<HttpInfo<ExecuteBatch200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.executeBatch(executeBatchRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.executeBatchWithHttpInfo(rsp)));
            }));
    }

    /**
     * Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.
     * Execute multiple credential operations in one request (#749)
     * @param executeBatchRequest
     */
    public executeBatch(executeBatchRequest: ExecuteBatchRequest, _options?: ConfigurationOptions): Observable<ExecuteBatch200Response> {
        return this.executeBatchWithHttpInfo(executeBatchRequest, _options).pipe(map((apiResponse: HttpInfo<ExecuteBatch200Response>) => apiResponse.data));
    }

    /**
     * Get API key metadata
     * @param id
     */
    public getApiKeyWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getApiKey(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getApiKeyWithHttpInfo(rsp)));
            }));
    }

    /**
     * Get API key metadata
     * @param id
     */
    public getApiKey(id: string, _options?: ConfigurationOptions): Observable<void> {
        return this.getApiKeyWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.
     * Get current API quota usage (#748)
     */
    public getQuotaWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<GetQuota200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getQuota(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getQuotaWithHttpInfo(rsp)));
            }));
    }

    /**
     * Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.
     * Get current API quota usage (#748)
     */
    public getQuota(_options?: ConfigurationOptions): Observable<GetQuota200Response> {
        return this.getQuotaWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<GetQuota200Response>) => apiResponse.data));
    }

    /**
     * Returns metadata for all issued API keys.
     * List API keys
     */
    public listApiKeysWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.listApiKeys(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.listApiKeysWithHttpInfo(rsp)));
            }));
    }

    /**
     * Returns metadata for all issued API keys.
     * List API keys
     */
    public listApiKeys(_options?: ConfigurationOptions): Observable<void> {
        return this.listApiKeysWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.
     * Long-poll for contract events (#750)
     * @param [contractId] Filter to events from one contract.
     * @param [topic] Comma-separated topic filter, positional (e.g. IDENTITY,updated).
     * @param [timeout] Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000).
     * @param [lastEventID] Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param.
     */
    public pollEventsWithHttpInfo(contractId?: string, topic?: string, timeout?: number, lastEventID?: string, _options?: ConfigurationOptions): Observable<HttpInfo<PollEvents200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.pollEvents(contractId, topic, timeout, lastEventID, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.pollEventsWithHttpInfo(rsp)));
            }));
    }

    /**
     * Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.
     * Long-poll for contract events (#750)
     * @param [contractId] Filter to events from one contract.
     * @param [topic] Comma-separated topic filter, positional (e.g. IDENTITY,updated).
     * @param [timeout] Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000).
     * @param [lastEventID] Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param.
     */
    public pollEvents(contractId?: string, topic?: string, timeout?: number, lastEventID?: string, _options?: ConfigurationOptions): Observable<PollEvents200Response> {
        return this.pollEventsWithHttpInfo(contractId, topic, timeout, lastEventID, _options).pipe(map((apiResponse: HttpInfo<PollEvents200Response>) => apiResponse.data));
    }

    /**
     * Rotate an API key
     * @param id
     */
    public rotateApiKeyWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.rotateApiKey(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.rotateApiKeyWithHttpInfo(rsp)));
            }));
    }

    /**
     * Rotate an API key
     * @param id
     */
    public rotateApiKey(id: string, _options?: ConfigurationOptions): Observable<void> {
        return this.rotateApiKeyWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Verifies up to 50 credentials in a single request for efficiency with partial success handling.
     * Verify multiple credentials in a single batch request
     * @param verifyCredentialsBatchRequest
     */
    public verifyCredentialsBatchWithHttpInfo(verifyCredentialsBatchRequest: VerifyCredentialsBatchRequest, _options?: ConfigurationOptions): Observable<HttpInfo<VerifyCredentialsBatch200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.verifyCredentialsBatch(verifyCredentialsBatchRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.verifyCredentialsBatchWithHttpInfo(rsp)));
            }));
    }

    /**
     * Verifies up to 50 credentials in a single request for efficiency with partial success handling.
     * Verify multiple credentials in a single batch request
     * @param verifyCredentialsBatchRequest
     */
    public verifyCredentialsBatch(verifyCredentialsBatchRequest: VerifyCredentialsBatchRequest, _options?: ConfigurationOptions): Observable<VerifyCredentialsBatch200Response> {
        return this.verifyCredentialsBatchWithHttpInfo(verifyCredentialsBatchRequest, _options).pipe(map((apiResponse: HttpInfo<VerifyCredentialsBatch200Response>) => apiResponse.data));
    }

}

import { GraphqlApiRequestFactory, GraphqlApiResponseProcessor} from "../apis/GraphqlApi";
export class ObservableGraphqlApi {
    private requestFactory: GraphqlApiRequestFactory;
    private responseProcessor: GraphqlApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: GraphqlApiRequestFactory,
        responseProcessor?: GraphqlApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new GraphqlApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new GraphqlApiResponseProcessor();
    }

    /**
     * Renders interactive GraphiQL playground in browser or executes query via query string.
     * GraphQL Playground / GET Query
     */
    public graphqlGetWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.graphqlGet(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.graphqlGetWithHttpInfo(rsp)));
            }));
    }

    /**
     * Renders interactive GraphiQL playground in browser or executes query via query string.
     * GraphQL Playground / GET Query
     */
    public graphqlGet(_options?: ConfigurationOptions): Observable<void> {
        return this.graphqlGetWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Executes GraphQL operation with DataLoader caching and batching.
     * Execute GraphQL query or mutation
     * @param graphqlPostRequest
     */
    public graphqlPostWithHttpInfo(graphqlPostRequest: GraphqlPostRequest, _options?: ConfigurationOptions): Observable<HttpInfo<GraphqlPost200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.graphqlPost(graphqlPostRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.graphqlPostWithHttpInfo(rsp)));
            }));
    }

    /**
     * Executes GraphQL operation with DataLoader caching and batching.
     * Execute GraphQL query or mutation
     * @param graphqlPostRequest
     */
    public graphqlPost(graphqlPostRequest: GraphqlPostRequest, _options?: ConfigurationOptions): Observable<GraphqlPost200Response> {
        return this.graphqlPostWithHttpInfo(graphqlPostRequest, _options).pipe(map((apiResponse: HttpInfo<GraphqlPost200Response>) => apiResponse.data));
    }

}

import { IdentityApiRequestFactory, IdentityApiResponseProcessor} from "../apis/IdentityApi";
export class ObservableIdentityApi {
    private requestFactory: IdentityApiRequestFactory;
    private responseProcessor: IdentityApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: IdentityApiRequestFactory,
        responseProcessor?: IdentityApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new IdentityApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new IdentityApiResponseProcessor();
    }

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param did
     */
    public resolveDidWithHttpInfo(did: string, _options?: ConfigurationOptions): Observable<HttpInfo<ResolveDid200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.resolveDid(did, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.resolveDidWithHttpInfo(rsp)));
            }));
    }

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param did
     */
    public resolveDid(did: string, _options?: ConfigurationOptions): Observable<ResolveDid200Response> {
        return this.resolveDidWithHttpInfo(did, _options).pipe(map((apiResponse: HttpInfo<ResolveDid200Response>) => apiResponse.data));
    }

}

import { OauthApiRequestFactory, OauthApiResponseProcessor} from "../apis/OauthApi";
export class ObservableOauthApi {
    private requestFactory: OauthApiRequestFactory;
    private responseProcessor: OauthApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: OauthApiRequestFactory,
        responseProcessor?: OauthApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new OauthApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new OauthApiResponseProcessor();
    }

    /**
     * Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client\'s registered scopes and the caller\'s own.
     * Authorization endpoint (authorization code grant)
     * @param responseType
     * @param clientId
     * @param redirectUri
     * @param [scope] Space-delimited scopes. Defaults to the client\&#39;s full registered scope set.
     * @param [state] Opaque value echoed back unchanged, to protect against CSRF.
     */
    public oauthAuthorizeWithHttpInfo(responseType: 'code', clientId: string, redirectUri: string, scope?: string, state?: string, _options?: ConfigurationOptions): Observable<HttpInfo<void>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.oauthAuthorize(responseType, clientId, redirectUri, scope, state, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.oauthAuthorizeWithHttpInfo(rsp)));
            }));
    }

    /**
     * Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client\'s registered scopes and the caller\'s own.
     * Authorization endpoint (authorization code grant)
     * @param responseType
     * @param clientId
     * @param redirectUri
     * @param [scope] Space-delimited scopes. Defaults to the client\&#39;s full registered scope set.
     * @param [state] Opaque value echoed back unchanged, to protect against CSRF.
     */
    public oauthAuthorize(responseType: 'code', clientId: string, redirectUri: string, scope?: string, state?: string, _options?: ConfigurationOptions): Observable<void> {
        return this.oauthAuthorizeWithHttpInfo(responseType, clientId, redirectUri, scope, state, _options).pipe(map((apiResponse: HttpInfo<void>) => apiResponse.data));
    }

    /**
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param oauthIntrospectRequest
     */
    public oauthIntrospectWithHttpInfo(oauthIntrospectRequest: OauthIntrospectRequest, _options?: ConfigurationOptions): Observable<HttpInfo<OauthIntrospect200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.oauthIntrospect(oauthIntrospectRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.oauthIntrospectWithHttpInfo(rsp)));
            }));
    }

    /**
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param oauthIntrospectRequest
     */
    public oauthIntrospect(oauthIntrospectRequest: OauthIntrospectRequest, _options?: ConfigurationOptions): Observable<OauthIntrospect200Response> {
        return this.oauthIntrospectWithHttpInfo(oauthIntrospectRequest, _options).pipe(map((apiResponse: HttpInfo<OauthIntrospect200Response>) => apiResponse.data));
    }

    /**
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param oauthIntrospectRequest
     */
    public oauthRevokeWithHttpInfo(oauthIntrospectRequest: OauthIntrospectRequest, _options?: ConfigurationOptions): Observable<HttpInfo<OauthRevoke200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.oauthRevoke(oauthIntrospectRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.oauthRevokeWithHttpInfo(rsp)));
            }));
    }

    /**
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param oauthIntrospectRequest
     */
    public oauthRevoke(oauthIntrospectRequest: OauthIntrospectRequest, _options?: ConfigurationOptions): Observable<OauthRevoke200Response> {
        return this.oauthRevokeWithHttpInfo(oauthIntrospectRequest, _options).pipe(map((apiResponse: HttpInfo<OauthRevoke200Response>) => apiResponse.data));
    }

    /**
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param oauthTokenRequest
     */
    public oauthTokenWithHttpInfo(oauthTokenRequest: OauthTokenRequest, _options?: ConfigurationOptions): Observable<HttpInfo<OauthToken200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.oauthToken(oauthTokenRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.oauthTokenWithHttpInfo(rsp)));
            }));
    }

    /**
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param oauthTokenRequest
     */
    public oauthToken(oauthTokenRequest: OauthTokenRequest, _options?: ConfigurationOptions): Observable<OauthToken200Response> {
        return this.oauthTokenWithHttpInfo(oauthTokenRequest, _options).pipe(map((apiResponse: HttpInfo<OauthToken200Response>) => apiResponse.data));
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param registerOauthClientRequest
     */
    public registerOauthClientWithHttpInfo(registerOauthClientRequest: RegisterOauthClientRequest, _options?: ConfigurationOptions): Observable<HttpInfo<RegisterOauthClient201Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.registerOauthClient(registerOauthClientRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.registerOauthClientWithHttpInfo(rsp)));
            }));
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param registerOauthClientRequest
     */
    public registerOauthClient(registerOauthClientRequest: RegisterOauthClientRequest, _options?: ConfigurationOptions): Observable<RegisterOauthClient201Response> {
        return this.registerOauthClientWithHttpInfo(registerOauthClientRequest, _options).pipe(map((apiResponse: HttpInfo<RegisterOauthClient201Response>) => apiResponse.data));
    }

}

import { SystemApiRequestFactory, SystemApiResponseProcessor} from "../apis/SystemApi";
export class ObservableSystemApi {
    private requestFactory: SystemApiRequestFactory;
    private responseProcessor: SystemApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: SystemApiRequestFactory,
        responseProcessor?: SystemApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new SystemApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new SystemApiResponseProcessor();
    }

    /**
     * Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.
     * Liveness and contract health probe
     */
    public getHealthWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<HealthResponse>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getHealth(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getHealthWithHttpInfo(rsp)));
            }));
    }

    /**
     * Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.
     * Liveness and contract health probe
     */
    public getHealth(_options?: ConfigurationOptions): Observable<HealthResponse> {
        return this.getHealthWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<HealthResponse>) => apiResponse.data));
    }

    /**
     * Renders Prometheus-formatted operational metrics.
     * Prometheus Metrics
     */
    public getMetricsWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<string>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getMetrics(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getMetricsWithHttpInfo(rsp)));
            }));
    }

    /**
     * Renders Prometheus-formatted operational metrics.
     * Prometheus Metrics
     */
    public getMetrics(_options?: ConfigurationOptions): Observable<string> {
        return this.getMetricsWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<string>) => apiResponse.data));
    }

    /**
     * Returns the complete OpenAPI 3.0.3 specification JSON.
     * Get OpenAPI Specification
     */
    public getOpenApiWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<any>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getOpenApi(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getOpenApiWithHttpInfo(rsp)));
            }));
    }

    /**
     * Returns the complete OpenAPI 3.0.3 specification JSON.
     * Get OpenAPI Specification
     */
    public getOpenApi(_options?: ConfigurationOptions): Observable<any> {
        return this.getOpenApiWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<any>) => apiResponse.data));
    }

    /**
     * Returns server version, API versioning info, and supported feature flags.
     * Server capability discovery
     */
    public getServerInfoWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<ServerInfo>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getServerInfo(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getServerInfoWithHttpInfo(rsp)));
            }));
    }

    /**
     * Returns server version, API versioning info, and supported feature flags.
     * Server capability discovery
     */
    public getServerInfo(_options?: ConfigurationOptions): Observable<ServerInfo> {
        return this.getServerInfoWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<ServerInfo>) => apiResponse.data));
    }

}

import { WebhooksApiRequestFactory, WebhooksApiResponseProcessor} from "../apis/WebhooksApi";
export class ObservableWebhooksApi {
    private requestFactory: WebhooksApiRequestFactory;
    private responseProcessor: WebhooksApiResponseProcessor;
    private configuration: Configuration;

    public constructor(
        configuration: Configuration,
        requestFactory?: WebhooksApiRequestFactory,
        responseProcessor?: WebhooksApiResponseProcessor
    ) {
        this.configuration = configuration;
        this.requestFactory = requestFactory || new WebhooksApiRequestFactory(configuration);
        this.responseProcessor = responseProcessor || new WebhooksApiResponseProcessor();
    }

    /**
     * Delete webhook
     * @param id
     */
    public deleteWebhookWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<DeleteWebhook200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.deleteWebhook(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.deleteWebhookWithHttpInfo(rsp)));
            }));
    }

    /**
     * Delete webhook
     * @param id
     */
    public deleteWebhook(id: string, _options?: ConfigurationOptions): Observable<DeleteWebhook200Response> {
        return this.deleteWebhookWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<DeleteWebhook200Response>) => apiResponse.data));
    }

    /**
     * Get webhook by ID
     * @param id
     */
    public getWebhookWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<Webhook>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.getWebhook(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.getWebhookWithHttpInfo(rsp)));
            }));
    }

    /**
     * Get webhook by ID
     * @param id
     */
    public getWebhook(id: string, _options?: ConfigurationOptions): Observable<Webhook> {
        return this.getWebhookWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<Webhook>) => apiResponse.data));
    }

    /**
     * Query webhook delivery logs
     * @param [webhookId]
     * @param [limit]
     */
    public listWebhookLogsWithHttpInfo(webhookId?: string, limit?: number, _options?: ConfigurationOptions): Observable<HttpInfo<ListWebhookLogs200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.listWebhookLogs(webhookId, limit, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.listWebhookLogsWithHttpInfo(rsp)));
            }));
    }

    /**
     * Query webhook delivery logs
     * @param [webhookId]
     * @param [limit]
     */
    public listWebhookLogs(webhookId?: string, limit?: number, _options?: ConfigurationOptions): Observable<ListWebhookLogs200Response> {
        return this.listWebhookLogsWithHttpInfo(webhookId, limit, _options).pipe(map((apiResponse: HttpInfo<ListWebhookLogs200Response>) => apiResponse.data));
    }

    /**
     * List registered webhooks
     */
    public listWebhooksWithHttpInfo(_options?: ConfigurationOptions): Observable<HttpInfo<ListWebhooks200Response>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.listWebhooks(_config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.listWebhooksWithHttpInfo(rsp)));
            }));
    }

    /**
     * List registered webhooks
     */
    public listWebhooks(_options?: ConfigurationOptions): Observable<ListWebhooks200Response> {
        return this.listWebhooksWithHttpInfo(_options).pipe(map((apiResponse: HttpInfo<ListWebhooks200Response>) => apiResponse.data));
    }

    /**
     * Register a new webhook endpoint
     * @param registerWebhookRequest
     */
    public registerWebhookWithHttpInfo(registerWebhookRequest: RegisterWebhookRequest, _options?: ConfigurationOptions): Observable<HttpInfo<Webhook>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.registerWebhook(registerWebhookRequest, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.registerWebhookWithHttpInfo(rsp)));
            }));
    }

    /**
     * Register a new webhook endpoint
     * @param registerWebhookRequest
     */
    public registerWebhook(registerWebhookRequest: RegisterWebhookRequest, _options?: ConfigurationOptions): Observable<Webhook> {
        return this.registerWebhookWithHttpInfo(registerWebhookRequest, _options).pipe(map((apiResponse: HttpInfo<Webhook>) => apiResponse.data));
    }

    /**
     * Test webhook delivery
     * @param id
     */
    public testWebhookWithHttpInfo(id: string, _options?: ConfigurationOptions): Observable<HttpInfo<WebhookLog>> {
        const _config = mergeConfiguration(this.configuration, _options);

        const requestContextPromise = this.requestFactory.testWebhook(id, _config);
        // build promise chain
        let middlewarePreObservable = from<RequestContext>(requestContextPromise);
        for (const middleware of _config.middleware) {
            middlewarePreObservable = middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => middleware.pre(ctx)));
        }

        return middlewarePreObservable.pipe(mergeMap((ctx: RequestContext) => _config.httpApi.send(ctx))).
            pipe(mergeMap((response: ResponseContext) => {
                let middlewarePostObservable = of(response);
                for (const middleware of _config.middleware.reverse()) {
                    middlewarePostObservable = middlewarePostObservable.pipe(mergeMap((rsp: ResponseContext) => middleware.post(rsp)));
                }
                return middlewarePostObservable.pipe(map((rsp: ResponseContext) => this.responseProcessor.testWebhookWithHttpInfo(rsp)));
            }));
    }

    /**
     * Test webhook delivery
     * @param id
     */
    public testWebhook(id: string, _options?: ConfigurationOptions): Observable<WebhookLog> {
        return this.testWebhookWithHttpInfo(id, _options).pipe(map((apiResponse: HttpInfo<WebhookLog>) => apiResponse.data));
    }

}
