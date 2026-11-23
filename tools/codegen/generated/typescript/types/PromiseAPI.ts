import { ResponseContext, RequestContext, HttpFile, HttpInfo } from '../http/http';
import { Configuration, PromiseConfigurationOptions, wrapOptions } from '../configuration'
import { PromiseMiddleware, Middleware, PromiseMiddlewareWrapper } from '../middleware';

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
import { ObservableCredentialsApi } from './ObservableAPI';

import { CredentialsApiRequestFactory, CredentialsApiResponseProcessor} from "../apis/CredentialsApi";
export class PromiseCredentialsApi {
    private api: ObservableCredentialsApi

    public constructor(
        configuration: Configuration,
        requestFactory?: CredentialsApiRequestFactory,
        responseProcessor?: CredentialsApiResponseProcessor
    ) {
        this.api = new ObservableCredentialsApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param id Unique identifier of the credential
     * @param [ifMatch] Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag.
     */
    public deleteCredentialWithHttpInfo(id: string, ifMatch?: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<CredentialRevokeResponse>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteCredentialWithHttpInfo(id, ifMatch, observableOptions);
        return result.toPromise();
    }

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param id Unique identifier of the credential
     * @param [ifMatch] Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag.
     */
    public deleteCredential(id: string, ifMatch?: string, _options?: PromiseConfigurationOptions): Promise<CredentialRevokeResponse> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteCredential(id, ifMatch, observableOptions);
        return result.toPromise();
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param id
     */
    public deleteCredentialRevocationWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<CredentialRevokeResponse>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteCredentialRevocationWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param id
     */
    public deleteCredentialRevocation(id: string, _options?: PromiseConfigurationOptions): Promise<CredentialRevokeResponse> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteCredentialRevocation(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param id Unique identifier of the credential
     * @param [fields] Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects.
     * @param [ifNoneMatch] Conditional GET. When it matches the current strong ETag, the server returns 304 with no body.
     */
    public getCredentialWithHttpInfo(id: string, fields?: string, ifNoneMatch?: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<Credential>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getCredentialWithHttpInfo(id, fields, ifNoneMatch, observableOptions);
        return result.toPromise();
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param id Unique identifier of the credential
     * @param [fields] Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects.
     * @param [ifNoneMatch] Conditional GET. When it matches the current strong ETag, the server returns 304 with no body.
     */
    public getCredential(id: string, fields?: string, ifNoneMatch?: string, _options?: PromiseConfigurationOptions): Promise<Credential> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getCredential(id, fields, ifNoneMatch, observableOptions);
        return result.toPromise();
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param issueCredentialRequest
     */
    public issueCredentialWithHttpInfo(issueCredentialRequest: IssueCredentialRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<Credential>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.issueCredentialWithHttpInfo(issueCredentialRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param issueCredentialRequest
     */
    public issueCredential(issueCredentialRequest: IssueCredentialRequest, _options?: PromiseConfigurationOptions): Promise<Credential> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.issueCredential(issueCredentialRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param issueCredentialRequest
     */
    public issueCredentialAliasWithHttpInfo(issueCredentialRequest: IssueCredentialRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<Credential>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.issueCredentialAliasWithHttpInfo(issueCredentialRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param issueCredentialRequest
     */
    public issueCredentialAlias(issueCredentialRequest: IssueCredentialRequest, _options?: PromiseConfigurationOptions): Promise<Credential> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.issueCredentialAlias(issueCredentialRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param [limit] Number of records to return (max 200)
     * @param [cursor] Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor
     * @param [direction] Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order.
     * @param [fields] Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object.
     */
    public listCredentialsWithHttpInfo(limit?: number, cursor?: string, direction?: 'next' | 'prev', fields?: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<PaginatedCredentials>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listCredentialsWithHttpInfo(limit, cursor, direction, fields, observableOptions);
        return result.toPromise();
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param [limit] Number of records to return (max 200)
     * @param [cursor] Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor
     * @param [direction] Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order.
     * @param [fields] Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object.
     */
    public listCredentials(limit?: number, cursor?: string, direction?: 'next' | 'prev', fields?: string, _options?: PromiseConfigurationOptions): Promise<PaginatedCredentials> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listCredentials(limit, cursor, direction, fields, observableOptions);
        return result.toPromise();
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param id
     */
    public revokeCredentialWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<CredentialRevokeResponse>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.revokeCredentialWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param id
     */
    public revokeCredential(id: string, _options?: PromiseConfigurationOptions): Promise<CredentialRevokeResponse> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.revokeCredential(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param id Identifier of the credential to verify
     */
    public verifyCredentialWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<CredentialVerifyResponse>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.verifyCredentialWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param id Identifier of the credential to verify
     */
    public verifyCredential(id: string, _options?: PromiseConfigurationOptions): Promise<CredentialVerifyResponse> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.verifyCredential(id, observableOptions);
        return result.toPromise();
    }


}



import { ObservableDefaultApi } from './ObservableAPI';

import { DefaultApiRequestFactory, DefaultApiResponseProcessor} from "../apis/DefaultApi";
export class PromiseDefaultApi {
    private api: ObservableDefaultApi

    public constructor(
        configuration: Configuration,
        requestFactory?: DefaultApiRequestFactory,
        responseProcessor?: DefaultApiResponseProcessor
    ) {
        this.api = new ObservableDefaultApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Issue an API key with configurable permissions and subscription tier.
     * Issue a new API key
     */
    public createApiKeyWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.createApiKeyWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Issue an API key with configurable permissions and subscription tier.
     * Issue a new API key
     */
    public createApiKey(_options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.createApiKey(observableOptions);
        return result.toPromise();
    }

    /**
     * Revoke an API key
     * @param id
     */
    public deleteApiKeyWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteApiKeyWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Revoke an API key
     * @param id
     */
    public deleteApiKey(id: string, _options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteApiKey(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.
     * Execute multiple credential operations in one request (#749)
     * @param executeBatchRequest
     */
    public executeBatchWithHttpInfo(executeBatchRequest: ExecuteBatchRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<ExecuteBatch200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.executeBatchWithHttpInfo(executeBatchRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.
     * Execute multiple credential operations in one request (#749)
     * @param executeBatchRequest
     */
    public executeBatch(executeBatchRequest: ExecuteBatchRequest, _options?: PromiseConfigurationOptions): Promise<ExecuteBatch200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.executeBatch(executeBatchRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Get API key metadata
     * @param id
     */
    public getApiKeyWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getApiKeyWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Get API key metadata
     * @param id
     */
    public getApiKey(id: string, _options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getApiKey(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.
     * Get current API quota usage (#748)
     */
    public getQuotaWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<GetQuota200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getQuotaWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.
     * Get current API quota usage (#748)
     */
    public getQuota(_options?: PromiseConfigurationOptions): Promise<GetQuota200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getQuota(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns metadata for all issued API keys.
     * List API keys
     */
    public listApiKeysWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listApiKeysWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns metadata for all issued API keys.
     * List API keys
     */
    public listApiKeys(_options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listApiKeys(observableOptions);
        return result.toPromise();
    }

    /**
     * Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.
     * Long-poll for contract events (#750)
     * @param [contractId] Filter to events from one contract.
     * @param [topic] Comma-separated topic filter, positional (e.g. IDENTITY,updated).
     * @param [timeout] Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000).
     * @param [lastEventID] Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param.
     */
    public pollEventsWithHttpInfo(contractId?: string, topic?: string, timeout?: number, lastEventID?: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<PollEvents200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.pollEventsWithHttpInfo(contractId, topic, timeout, lastEventID, observableOptions);
        return result.toPromise();
    }

    /**
     * Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.
     * Long-poll for contract events (#750)
     * @param [contractId] Filter to events from one contract.
     * @param [topic] Comma-separated topic filter, positional (e.g. IDENTITY,updated).
     * @param [timeout] Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000).
     * @param [lastEventID] Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param.
     */
    public pollEvents(contractId?: string, topic?: string, timeout?: number, lastEventID?: string, _options?: PromiseConfigurationOptions): Promise<PollEvents200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.pollEvents(contractId, topic, timeout, lastEventID, observableOptions);
        return result.toPromise();
    }

    /**
     * Rotate an API key
     * @param id
     */
    public rotateApiKeyWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.rotateApiKeyWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Rotate an API key
     * @param id
     */
    public rotateApiKey(id: string, _options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.rotateApiKey(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Verifies up to 50 credentials in a single request for efficiency with partial success handling.
     * Verify multiple credentials in a single batch request
     * @param verifyCredentialsBatchRequest
     */
    public verifyCredentialsBatchWithHttpInfo(verifyCredentialsBatchRequest: VerifyCredentialsBatchRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<VerifyCredentialsBatch200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.verifyCredentialsBatchWithHttpInfo(verifyCredentialsBatchRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Verifies up to 50 credentials in a single request for efficiency with partial success handling.
     * Verify multiple credentials in a single batch request
     * @param verifyCredentialsBatchRequest
     */
    public verifyCredentialsBatch(verifyCredentialsBatchRequest: VerifyCredentialsBatchRequest, _options?: PromiseConfigurationOptions): Promise<VerifyCredentialsBatch200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.verifyCredentialsBatch(verifyCredentialsBatchRequest, observableOptions);
        return result.toPromise();
    }


}



import { ObservableGraphqlApi } from './ObservableAPI';

import { GraphqlApiRequestFactory, GraphqlApiResponseProcessor} from "../apis/GraphqlApi";
export class PromiseGraphqlApi {
    private api: ObservableGraphqlApi

    public constructor(
        configuration: Configuration,
        requestFactory?: GraphqlApiRequestFactory,
        responseProcessor?: GraphqlApiResponseProcessor
    ) {
        this.api = new ObservableGraphqlApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Renders interactive GraphiQL playground in browser or executes query via query string.
     * GraphQL Playground / GET Query
     */
    public graphqlGetWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.graphqlGetWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Renders interactive GraphiQL playground in browser or executes query via query string.
     * GraphQL Playground / GET Query
     */
    public graphqlGet(_options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.graphqlGet(observableOptions);
        return result.toPromise();
    }

    /**
     * Executes GraphQL operation with DataLoader caching and batching.
     * Execute GraphQL query or mutation
     * @param graphqlPostRequest
     */
    public graphqlPostWithHttpInfo(graphqlPostRequest: GraphqlPostRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<GraphqlPost200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.graphqlPostWithHttpInfo(graphqlPostRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Executes GraphQL operation with DataLoader caching and batching.
     * Execute GraphQL query or mutation
     * @param graphqlPostRequest
     */
    public graphqlPost(graphqlPostRequest: GraphqlPostRequest, _options?: PromiseConfigurationOptions): Promise<GraphqlPost200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.graphqlPost(graphqlPostRequest, observableOptions);
        return result.toPromise();
    }


}



import { ObservableIdentityApi } from './ObservableAPI';

import { IdentityApiRequestFactory, IdentityApiResponseProcessor} from "../apis/IdentityApi";
export class PromiseIdentityApi {
    private api: ObservableIdentityApi

    public constructor(
        configuration: Configuration,
        requestFactory?: IdentityApiRequestFactory,
        responseProcessor?: IdentityApiResponseProcessor
    ) {
        this.api = new ObservableIdentityApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param did
     */
    public resolveDidWithHttpInfo(did: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<ResolveDid200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.resolveDidWithHttpInfo(did, observableOptions);
        return result.toPromise();
    }

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param did
     */
    public resolveDid(did: string, _options?: PromiseConfigurationOptions): Promise<ResolveDid200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.resolveDid(did, observableOptions);
        return result.toPromise();
    }


}



import { ObservableOauthApi } from './ObservableAPI';

import { OauthApiRequestFactory, OauthApiResponseProcessor} from "../apis/OauthApi";
export class PromiseOauthApi {
    private api: ObservableOauthApi

    public constructor(
        configuration: Configuration,
        requestFactory?: OauthApiRequestFactory,
        responseProcessor?: OauthApiResponseProcessor
    ) {
        this.api = new ObservableOauthApi(configuration, requestFactory, responseProcessor);
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
    public oauthAuthorizeWithHttpInfo(responseType: 'code', clientId: string, redirectUri: string, scope?: string, state?: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<void>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthAuthorizeWithHttpInfo(responseType, clientId, redirectUri, scope, state, observableOptions);
        return result.toPromise();
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
    public oauthAuthorize(responseType: 'code', clientId: string, redirectUri: string, scope?: string, state?: string, _options?: PromiseConfigurationOptions): Promise<void> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthAuthorize(responseType, clientId, redirectUri, scope, state, observableOptions);
        return result.toPromise();
    }

    /**
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param oauthIntrospectRequest
     */
    public oauthIntrospectWithHttpInfo(oauthIntrospectRequest: OauthIntrospectRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<OauthIntrospect200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthIntrospectWithHttpInfo(oauthIntrospectRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param oauthIntrospectRequest
     */
    public oauthIntrospect(oauthIntrospectRequest: OauthIntrospectRequest, _options?: PromiseConfigurationOptions): Promise<OauthIntrospect200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthIntrospect(oauthIntrospectRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param oauthIntrospectRequest
     */
    public oauthRevokeWithHttpInfo(oauthIntrospectRequest: OauthIntrospectRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<OauthRevoke200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthRevokeWithHttpInfo(oauthIntrospectRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param oauthIntrospectRequest
     */
    public oauthRevoke(oauthIntrospectRequest: OauthIntrospectRequest, _options?: PromiseConfigurationOptions): Promise<OauthRevoke200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthRevoke(oauthIntrospectRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param oauthTokenRequest
     */
    public oauthTokenWithHttpInfo(oauthTokenRequest: OauthTokenRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<OauthToken200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthTokenWithHttpInfo(oauthTokenRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param oauthTokenRequest
     */
    public oauthToken(oauthTokenRequest: OauthTokenRequest, _options?: PromiseConfigurationOptions): Promise<OauthToken200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.oauthToken(oauthTokenRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param registerOauthClientRequest
     */
    public registerOauthClientWithHttpInfo(registerOauthClientRequest: RegisterOauthClientRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<RegisterOauthClient201Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.registerOauthClientWithHttpInfo(registerOauthClientRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param registerOauthClientRequest
     */
    public registerOauthClient(registerOauthClientRequest: RegisterOauthClientRequest, _options?: PromiseConfigurationOptions): Promise<RegisterOauthClient201Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.registerOauthClient(registerOauthClientRequest, observableOptions);
        return result.toPromise();
    }


}



import { ObservableSystemApi } from './ObservableAPI';

import { SystemApiRequestFactory, SystemApiResponseProcessor} from "../apis/SystemApi";
export class PromiseSystemApi {
    private api: ObservableSystemApi

    public constructor(
        configuration: Configuration,
        requestFactory?: SystemApiRequestFactory,
        responseProcessor?: SystemApiResponseProcessor
    ) {
        this.api = new ObservableSystemApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.
     * Liveness and contract health probe
     */
    public getHealthWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<HealthResponse>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getHealthWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.
     * Liveness and contract health probe
     */
    public getHealth(_options?: PromiseConfigurationOptions): Promise<HealthResponse> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getHealth(observableOptions);
        return result.toPromise();
    }

    /**
     * Renders Prometheus-formatted operational metrics.
     * Prometheus Metrics
     */
    public getMetricsWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<string>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getMetricsWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Renders Prometheus-formatted operational metrics.
     * Prometheus Metrics
     */
    public getMetrics(_options?: PromiseConfigurationOptions): Promise<string> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getMetrics(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns the complete OpenAPI 3.0.3 specification JSON.
     * Get OpenAPI Specification
     */
    public getOpenApiWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<any>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getOpenApiWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns the complete OpenAPI 3.0.3 specification JSON.
     * Get OpenAPI Specification
     */
    public getOpenApi(_options?: PromiseConfigurationOptions): Promise<any> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getOpenApi(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns server version, API versioning info, and supported feature flags.
     * Server capability discovery
     */
    public getServerInfoWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<ServerInfo>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getServerInfoWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * Returns server version, API versioning info, and supported feature flags.
     * Server capability discovery
     */
    public getServerInfo(_options?: PromiseConfigurationOptions): Promise<ServerInfo> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getServerInfo(observableOptions);
        return result.toPromise();
    }


}



import { ObservableWebhooksApi } from './ObservableAPI';

import { WebhooksApiRequestFactory, WebhooksApiResponseProcessor} from "../apis/WebhooksApi";
export class PromiseWebhooksApi {
    private api: ObservableWebhooksApi

    public constructor(
        configuration: Configuration,
        requestFactory?: WebhooksApiRequestFactory,
        responseProcessor?: WebhooksApiResponseProcessor
    ) {
        this.api = new ObservableWebhooksApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Delete webhook
     * @param id
     */
    public deleteWebhookWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<DeleteWebhook200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteWebhookWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Delete webhook
     * @param id
     */
    public deleteWebhook(id: string, _options?: PromiseConfigurationOptions): Promise<DeleteWebhook200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.deleteWebhook(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Get webhook by ID
     * @param id
     */
    public getWebhookWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<Webhook>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getWebhookWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Get webhook by ID
     * @param id
     */
    public getWebhook(id: string, _options?: PromiseConfigurationOptions): Promise<Webhook> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.getWebhook(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Query webhook delivery logs
     * @param [webhookId]
     * @param [limit]
     */
    public listWebhookLogsWithHttpInfo(webhookId?: string, limit?: number, _options?: PromiseConfigurationOptions): Promise<HttpInfo<ListWebhookLogs200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listWebhookLogsWithHttpInfo(webhookId, limit, observableOptions);
        return result.toPromise();
    }

    /**
     * Query webhook delivery logs
     * @param [webhookId]
     * @param [limit]
     */
    public listWebhookLogs(webhookId?: string, limit?: number, _options?: PromiseConfigurationOptions): Promise<ListWebhookLogs200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listWebhookLogs(webhookId, limit, observableOptions);
        return result.toPromise();
    }

    /**
     * List registered webhooks
     */
    public listWebhooksWithHttpInfo(_options?: PromiseConfigurationOptions): Promise<HttpInfo<ListWebhooks200Response>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listWebhooksWithHttpInfo(observableOptions);
        return result.toPromise();
    }

    /**
     * List registered webhooks
     */
    public listWebhooks(_options?: PromiseConfigurationOptions): Promise<ListWebhooks200Response> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.listWebhooks(observableOptions);
        return result.toPromise();
    }

    /**
     * Register a new webhook endpoint
     * @param registerWebhookRequest
     */
    public registerWebhookWithHttpInfo(registerWebhookRequest: RegisterWebhookRequest, _options?: PromiseConfigurationOptions): Promise<HttpInfo<Webhook>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.registerWebhookWithHttpInfo(registerWebhookRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Register a new webhook endpoint
     * @param registerWebhookRequest
     */
    public registerWebhook(registerWebhookRequest: RegisterWebhookRequest, _options?: PromiseConfigurationOptions): Promise<Webhook> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.registerWebhook(registerWebhookRequest, observableOptions);
        return result.toPromise();
    }

    /**
     * Test webhook delivery
     * @param id
     */
    public testWebhookWithHttpInfo(id: string, _options?: PromiseConfigurationOptions): Promise<HttpInfo<WebhookLog>> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.testWebhookWithHttpInfo(id, observableOptions);
        return result.toPromise();
    }

    /**
     * Test webhook delivery
     * @param id
     */
    public testWebhook(id: string, _options?: PromiseConfigurationOptions): Promise<WebhookLog> {
        const observableOptions = wrapOptions(_options);
        const result = this.api.testWebhook(id, observableOptions);
        return result.toPromise();
    }


}



