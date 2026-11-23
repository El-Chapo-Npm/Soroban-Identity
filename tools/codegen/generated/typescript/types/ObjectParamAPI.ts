import { ResponseContext, RequestContext, HttpFile, HttpInfo } from '../http/http';
import { Configuration, ConfigurationOptions } from '../configuration'
import type { Middleware } from '../middleware';

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

import { ObservableCredentialsApi } from "./ObservableAPI";
import { CredentialsApiRequestFactory, CredentialsApiResponseProcessor} from "../apis/CredentialsApi";

export interface CredentialsApiDeleteCredentialRequest {
    /**
     * Unique identifier of the credential
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApideleteCredential
     */
    id: string
    /**
     * Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag.
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApideleteCredential
     */
    ifMatch?: string
}

export interface CredentialsApiDeleteCredentialRevocationRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApideleteCredentialRevocation
     */
    id: string
}

export interface CredentialsApiGetCredentialRequest {
    /**
     * Unique identifier of the credential
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApigetCredential
     */
    id: string
    /**
     * Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects.
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApigetCredential
     */
    fields?: string
    /**
     * Conditional GET. When it matches the current strong ETag, the server returns 304 with no body.
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApigetCredential
     */
    ifNoneMatch?: string
}

export interface CredentialsApiIssueCredentialRequest {
    /**
     * 
     * @type IssueCredentialRequest
     * @memberof CredentialsApiissueCredential
     */
    issueCredentialRequest: IssueCredentialRequest
}

export interface CredentialsApiIssueCredentialAliasRequest {
    /**
     * 
     * @type IssueCredentialRequest
     * @memberof CredentialsApiissueCredentialAlias
     */
    issueCredentialRequest: IssueCredentialRequest
}

export interface CredentialsApiListCredentialsRequest {
    /**
     * Number of records to return (max 200)
     * Maximum: 200
     * Defaults to: 50
     * @type number
     * @memberof CredentialsApilistCredentials
     */
    limit?: number
    /**
     * Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApilistCredentials
     */
    cursor?: string
    /**
     * Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order.
     * Defaults to: &#39;next&#39;
     * @type &#39;next&#39; | &#39;prev&#39;
     * @memberof CredentialsApilistCredentials
     */
    direction?: 'next' | 'prev'
    /**
     * Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object.
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApilistCredentials
     */
    fields?: string
}

export interface CredentialsApiRevokeCredentialRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApirevokeCredential
     */
    id: string
}

export interface CredentialsApiVerifyCredentialRequest {
    /**
     * Identifier of the credential to verify
     * Defaults to: undefined
     * @type string
     * @memberof CredentialsApiverifyCredential
     */
    id: string
}

export class ObjectCredentialsApi {
    private api: ObservableCredentialsApi

    public constructor(configuration: Configuration, requestFactory?: CredentialsApiRequestFactory, responseProcessor?: CredentialsApiResponseProcessor) {
        this.api = new ObservableCredentialsApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param param the request object
     */
    public deleteCredentialWithHttpInfo(param: CredentialsApiDeleteCredentialRequest, options?: ConfigurationOptions): Promise<HttpInfo<CredentialRevokeResponse>> {
        return this.api.deleteCredentialWithHttpInfo(param.id, param.ifMatch,  options).toPromise();
    }

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param param the request object
     */
    public deleteCredential(param: CredentialsApiDeleteCredentialRequest, options?: ConfigurationOptions): Promise<CredentialRevokeResponse> {
        return this.api.deleteCredential(param.id, param.ifMatch,  options).toPromise();
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param param the request object
     */
    public deleteCredentialRevocationWithHttpInfo(param: CredentialsApiDeleteCredentialRevocationRequest, options?: ConfigurationOptions): Promise<HttpInfo<CredentialRevokeResponse>> {
        return this.api.deleteCredentialRevocationWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param param the request object
     */
    public deleteCredentialRevocation(param: CredentialsApiDeleteCredentialRevocationRequest, options?: ConfigurationOptions): Promise<CredentialRevokeResponse> {
        return this.api.deleteCredentialRevocation(param.id,  options).toPromise();
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param param the request object
     */
    public getCredentialWithHttpInfo(param: CredentialsApiGetCredentialRequest, options?: ConfigurationOptions): Promise<HttpInfo<Credential>> {
        return this.api.getCredentialWithHttpInfo(param.id, param.fields, param.ifNoneMatch,  options).toPromise();
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param param the request object
     */
    public getCredential(param: CredentialsApiGetCredentialRequest, options?: ConfigurationOptions): Promise<Credential> {
        return this.api.getCredential(param.id, param.fields, param.ifNoneMatch,  options).toPromise();
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param param the request object
     */
    public issueCredentialWithHttpInfo(param: CredentialsApiIssueCredentialRequest, options?: ConfigurationOptions): Promise<HttpInfo<Credential>> {
        return this.api.issueCredentialWithHttpInfo(param.issueCredentialRequest,  options).toPromise();
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param param the request object
     */
    public issueCredential(param: CredentialsApiIssueCredentialRequest, options?: ConfigurationOptions): Promise<Credential> {
        return this.api.issueCredential(param.issueCredentialRequest,  options).toPromise();
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param param the request object
     */
    public issueCredentialAliasWithHttpInfo(param: CredentialsApiIssueCredentialAliasRequest, options?: ConfigurationOptions): Promise<HttpInfo<Credential>> {
        return this.api.issueCredentialAliasWithHttpInfo(param.issueCredentialRequest,  options).toPromise();
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param param the request object
     */
    public issueCredentialAlias(param: CredentialsApiIssueCredentialAliasRequest, options?: ConfigurationOptions): Promise<Credential> {
        return this.api.issueCredentialAlias(param.issueCredentialRequest,  options).toPromise();
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param param the request object
     */
    public listCredentialsWithHttpInfo(param: CredentialsApiListCredentialsRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<PaginatedCredentials>> {
        return this.api.listCredentialsWithHttpInfo(param.limit, param.cursor, param.direction, param.fields,  options).toPromise();
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param param the request object
     */
    public listCredentials(param: CredentialsApiListCredentialsRequest = {}, options?: ConfigurationOptions): Promise<PaginatedCredentials> {
        return this.api.listCredentials(param.limit, param.cursor, param.direction, param.fields,  options).toPromise();
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param param the request object
     */
    public revokeCredentialWithHttpInfo(param: CredentialsApiRevokeCredentialRequest, options?: ConfigurationOptions): Promise<HttpInfo<CredentialRevokeResponse>> {
        return this.api.revokeCredentialWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param param the request object
     */
    public revokeCredential(param: CredentialsApiRevokeCredentialRequest, options?: ConfigurationOptions): Promise<CredentialRevokeResponse> {
        return this.api.revokeCredential(param.id,  options).toPromise();
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param param the request object
     */
    public verifyCredentialWithHttpInfo(param: CredentialsApiVerifyCredentialRequest, options?: ConfigurationOptions): Promise<HttpInfo<CredentialVerifyResponse>> {
        return this.api.verifyCredentialWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param param the request object
     */
    public verifyCredential(param: CredentialsApiVerifyCredentialRequest, options?: ConfigurationOptions): Promise<CredentialVerifyResponse> {
        return this.api.verifyCredential(param.id,  options).toPromise();
    }

}

import { ObservableDefaultApi } from "./ObservableAPI";
import { DefaultApiRequestFactory, DefaultApiResponseProcessor} from "../apis/DefaultApi";

export interface DefaultApiCreateApiKeyRequest {
}

export interface DefaultApiDeleteApiKeyRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof DefaultApideleteApiKey
     */
    id: string
}

export interface DefaultApiExecuteBatchRequest {
    /**
     * 
     * @type ExecuteBatchRequest
     * @memberof DefaultApiexecuteBatch
     */
    executeBatchRequest: ExecuteBatchRequest
}

export interface DefaultApiGetApiKeyRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof DefaultApigetApiKey
     */
    id: string
}

export interface DefaultApiGetQuotaRequest {
}

export interface DefaultApiListApiKeysRequest {
}

export interface DefaultApiPollEventsRequest {
    /**
     * Filter to events from one contract.
     * Defaults to: undefined
     * @type string
     * @memberof DefaultApipollEvents
     */
    contractId?: string
    /**
     * Comma-separated topic filter, positional (e.g. IDENTITY,updated).
     * Defaults to: undefined
     * @type string
     * @memberof DefaultApipollEvents
     */
    topic?: string
    /**
     * Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000).
     * Defaults to: undefined
     * @type number
     * @memberof DefaultApipollEvents
     */
    timeout?: number
    /**
     * Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param.
     * Defaults to: undefined
     * @type string
     * @memberof DefaultApipollEvents
     */
    lastEventID?: string
}

export interface DefaultApiRotateApiKeyRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof DefaultApirotateApiKey
     */
    id: string
}

export interface DefaultApiVerifyCredentialsBatchRequest {
    /**
     * 
     * @type VerifyCredentialsBatchRequest
     * @memberof DefaultApiverifyCredentialsBatch
     */
    verifyCredentialsBatchRequest: VerifyCredentialsBatchRequest
}

export class ObjectDefaultApi {
    private api: ObservableDefaultApi

    public constructor(configuration: Configuration, requestFactory?: DefaultApiRequestFactory, responseProcessor?: DefaultApiResponseProcessor) {
        this.api = new ObservableDefaultApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Issue an API key with configurable permissions and subscription tier.
     * Issue a new API key
     * @param param the request object
     */
    public createApiKeyWithHttpInfo(param: DefaultApiCreateApiKeyRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.createApiKeyWithHttpInfo( options).toPromise();
    }

    /**
     * Issue an API key with configurable permissions and subscription tier.
     * Issue a new API key
     * @param param the request object
     */
    public createApiKey(param: DefaultApiCreateApiKeyRequest = {}, options?: ConfigurationOptions): Promise<void> {
        return this.api.createApiKey( options).toPromise();
    }

    /**
     * Revoke an API key
     * @param param the request object
     */
    public deleteApiKeyWithHttpInfo(param: DefaultApiDeleteApiKeyRequest, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.deleteApiKeyWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Revoke an API key
     * @param param the request object
     */
    public deleteApiKey(param: DefaultApiDeleteApiKeyRequest, options?: ConfigurationOptions): Promise<void> {
        return this.api.deleteApiKey(param.id,  options).toPromise();
    }

    /**
     * Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.
     * Execute multiple credential operations in one request (#749)
     * @param param the request object
     */
    public executeBatchWithHttpInfo(param: DefaultApiExecuteBatchRequest, options?: ConfigurationOptions): Promise<HttpInfo<ExecuteBatch200Response>> {
        return this.api.executeBatchWithHttpInfo(param.executeBatchRequest,  options).toPromise();
    }

    /**
     * Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.
     * Execute multiple credential operations in one request (#749)
     * @param param the request object
     */
    public executeBatch(param: DefaultApiExecuteBatchRequest, options?: ConfigurationOptions): Promise<ExecuteBatch200Response> {
        return this.api.executeBatch(param.executeBatchRequest,  options).toPromise();
    }

    /**
     * Get API key metadata
     * @param param the request object
     */
    public getApiKeyWithHttpInfo(param: DefaultApiGetApiKeyRequest, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.getApiKeyWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Get API key metadata
     * @param param the request object
     */
    public getApiKey(param: DefaultApiGetApiKeyRequest, options?: ConfigurationOptions): Promise<void> {
        return this.api.getApiKey(param.id,  options).toPromise();
    }

    /**
     * Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.
     * Get current API quota usage (#748)
     * @param param the request object
     */
    public getQuotaWithHttpInfo(param: DefaultApiGetQuotaRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<GetQuota200Response>> {
        return this.api.getQuotaWithHttpInfo( options).toPromise();
    }

    /**
     * Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.
     * Get current API quota usage (#748)
     * @param param the request object
     */
    public getQuota(param: DefaultApiGetQuotaRequest = {}, options?: ConfigurationOptions): Promise<GetQuota200Response> {
        return this.api.getQuota( options).toPromise();
    }

    /**
     * Returns metadata for all issued API keys.
     * List API keys
     * @param param the request object
     */
    public listApiKeysWithHttpInfo(param: DefaultApiListApiKeysRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.listApiKeysWithHttpInfo( options).toPromise();
    }

    /**
     * Returns metadata for all issued API keys.
     * List API keys
     * @param param the request object
     */
    public listApiKeys(param: DefaultApiListApiKeysRequest = {}, options?: ConfigurationOptions): Promise<void> {
        return this.api.listApiKeys( options).toPromise();
    }

    /**
     * Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.
     * Long-poll for contract events (#750)
     * @param param the request object
     */
    public pollEventsWithHttpInfo(param: DefaultApiPollEventsRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<PollEvents200Response>> {
        return this.api.pollEventsWithHttpInfo(param.contractId, param.topic, param.timeout, param.lastEventID,  options).toPromise();
    }

    /**
     * Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.
     * Long-poll for contract events (#750)
     * @param param the request object
     */
    public pollEvents(param: DefaultApiPollEventsRequest = {}, options?: ConfigurationOptions): Promise<PollEvents200Response> {
        return this.api.pollEvents(param.contractId, param.topic, param.timeout, param.lastEventID,  options).toPromise();
    }

    /**
     * Rotate an API key
     * @param param the request object
     */
    public rotateApiKeyWithHttpInfo(param: DefaultApiRotateApiKeyRequest, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.rotateApiKeyWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Rotate an API key
     * @param param the request object
     */
    public rotateApiKey(param: DefaultApiRotateApiKeyRequest, options?: ConfigurationOptions): Promise<void> {
        return this.api.rotateApiKey(param.id,  options).toPromise();
    }

    /**
     * Verifies up to 50 credentials in a single request for efficiency with partial success handling.
     * Verify multiple credentials in a single batch request
     * @param param the request object
     */
    public verifyCredentialsBatchWithHttpInfo(param: DefaultApiVerifyCredentialsBatchRequest, options?: ConfigurationOptions): Promise<HttpInfo<VerifyCredentialsBatch200Response>> {
        return this.api.verifyCredentialsBatchWithHttpInfo(param.verifyCredentialsBatchRequest,  options).toPromise();
    }

    /**
     * Verifies up to 50 credentials in a single request for efficiency with partial success handling.
     * Verify multiple credentials in a single batch request
     * @param param the request object
     */
    public verifyCredentialsBatch(param: DefaultApiVerifyCredentialsBatchRequest, options?: ConfigurationOptions): Promise<VerifyCredentialsBatch200Response> {
        return this.api.verifyCredentialsBatch(param.verifyCredentialsBatchRequest,  options).toPromise();
    }

}

import { ObservableGraphqlApi } from "./ObservableAPI";
import { GraphqlApiRequestFactory, GraphqlApiResponseProcessor} from "../apis/GraphqlApi";

export interface GraphqlApiGraphqlGetRequest {
}

export interface GraphqlApiGraphqlPostRequest {
    /**
     * 
     * @type GraphqlPostRequest
     * @memberof GraphqlApigraphqlPost
     */
    graphqlPostRequest: GraphqlPostRequest
}

export class ObjectGraphqlApi {
    private api: ObservableGraphqlApi

    public constructor(configuration: Configuration, requestFactory?: GraphqlApiRequestFactory, responseProcessor?: GraphqlApiResponseProcessor) {
        this.api = new ObservableGraphqlApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Renders interactive GraphiQL playground in browser or executes query via query string.
     * GraphQL Playground / GET Query
     * @param param the request object
     */
    public graphqlGetWithHttpInfo(param: GraphqlApiGraphqlGetRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.graphqlGetWithHttpInfo( options).toPromise();
    }

    /**
     * Renders interactive GraphiQL playground in browser or executes query via query string.
     * GraphQL Playground / GET Query
     * @param param the request object
     */
    public graphqlGet(param: GraphqlApiGraphqlGetRequest = {}, options?: ConfigurationOptions): Promise<void> {
        return this.api.graphqlGet( options).toPromise();
    }

    /**
     * Executes GraphQL operation with DataLoader caching and batching.
     * Execute GraphQL query or mutation
     * @param param the request object
     */
    public graphqlPostWithHttpInfo(param: GraphqlApiGraphqlPostRequest, options?: ConfigurationOptions): Promise<HttpInfo<GraphqlPost200Response>> {
        return this.api.graphqlPostWithHttpInfo(param.graphqlPostRequest,  options).toPromise();
    }

    /**
     * Executes GraphQL operation with DataLoader caching and batching.
     * Execute GraphQL query or mutation
     * @param param the request object
     */
    public graphqlPost(param: GraphqlApiGraphqlPostRequest, options?: ConfigurationOptions): Promise<GraphqlPost200Response> {
        return this.api.graphqlPost(param.graphqlPostRequest,  options).toPromise();
    }

}

import { ObservableIdentityApi } from "./ObservableAPI";
import { IdentityApiRequestFactory, IdentityApiResponseProcessor} from "../apis/IdentityApi";

export interface IdentityApiResolveDidRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof IdentityApiresolveDid
     */
    did: string
}

export class ObjectIdentityApi {
    private api: ObservableIdentityApi

    public constructor(configuration: Configuration, requestFactory?: IdentityApiRequestFactory, responseProcessor?: IdentityApiResponseProcessor) {
        this.api = new ObservableIdentityApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param param the request object
     */
    public resolveDidWithHttpInfo(param: IdentityApiResolveDidRequest, options?: ConfigurationOptions): Promise<HttpInfo<ResolveDid200Response>> {
        return this.api.resolveDidWithHttpInfo(param.did,  options).toPromise();
    }

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param param the request object
     */
    public resolveDid(param: IdentityApiResolveDidRequest, options?: ConfigurationOptions): Promise<ResolveDid200Response> {
        return this.api.resolveDid(param.did,  options).toPromise();
    }

}

import { ObservableOauthApi } from "./ObservableAPI";
import { OauthApiRequestFactory, OauthApiResponseProcessor} from "../apis/OauthApi";

export interface OauthApiOauthAuthorizeRequest {
    /**
     * 
     * Defaults to: undefined
     * @type &#39;code&#39;
     * @memberof OauthApioauthAuthorize
     */
    responseType: 'code'
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof OauthApioauthAuthorize
     */
    clientId: string
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof OauthApioauthAuthorize
     */
    redirectUri: string
    /**
     * Space-delimited scopes. Defaults to the client\&#39;s full registered scope set.
     * Defaults to: undefined
     * @type string
     * @memberof OauthApioauthAuthorize
     */
    scope?: string
    /**
     * Opaque value echoed back unchanged, to protect against CSRF.
     * Defaults to: undefined
     * @type string
     * @memberof OauthApioauthAuthorize
     */
    state?: string
}

export interface OauthApiOauthIntrospectRequest {
    /**
     * 
     * @type OauthIntrospectRequest
     * @memberof OauthApioauthIntrospect
     */
    oauthIntrospectRequest: OauthIntrospectRequest
}

export interface OauthApiOauthRevokeRequest {
    /**
     * 
     * @type OauthIntrospectRequest
     * @memberof OauthApioauthRevoke
     */
    oauthIntrospectRequest: OauthIntrospectRequest
}

export interface OauthApiOauthTokenRequest {
    /**
     * 
     * @type OauthTokenRequest
     * @memberof OauthApioauthToken
     */
    oauthTokenRequest: OauthTokenRequest
}

export interface OauthApiRegisterOauthClientRequest {
    /**
     * 
     * @type RegisterOauthClientRequest
     * @memberof OauthApiregisterOauthClient
     */
    registerOauthClientRequest: RegisterOauthClientRequest
}

export class ObjectOauthApi {
    private api: ObservableOauthApi

    public constructor(configuration: Configuration, requestFactory?: OauthApiRequestFactory, responseProcessor?: OauthApiResponseProcessor) {
        this.api = new ObservableOauthApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client\'s registered scopes and the caller\'s own.
     * Authorization endpoint (authorization code grant)
     * @param param the request object
     */
    public oauthAuthorizeWithHttpInfo(param: OauthApiOauthAuthorizeRequest, options?: ConfigurationOptions): Promise<HttpInfo<void>> {
        return this.api.oauthAuthorizeWithHttpInfo(param.responseType, param.clientId, param.redirectUri, param.scope, param.state,  options).toPromise();
    }

    /**
     * Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client\'s registered scopes and the caller\'s own.
     * Authorization endpoint (authorization code grant)
     * @param param the request object
     */
    public oauthAuthorize(param: OauthApiOauthAuthorizeRequest, options?: ConfigurationOptions): Promise<void> {
        return this.api.oauthAuthorize(param.responseType, param.clientId, param.redirectUri, param.scope, param.state,  options).toPromise();
    }

    /**
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param param the request object
     */
    public oauthIntrospectWithHttpInfo(param: OauthApiOauthIntrospectRequest, options?: ConfigurationOptions): Promise<HttpInfo<OauthIntrospect200Response>> {
        return this.api.oauthIntrospectWithHttpInfo(param.oauthIntrospectRequest,  options).toPromise();
    }

    /**
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param param the request object
     */
    public oauthIntrospect(param: OauthApiOauthIntrospectRequest, options?: ConfigurationOptions): Promise<OauthIntrospect200Response> {
        return this.api.oauthIntrospect(param.oauthIntrospectRequest,  options).toPromise();
    }

    /**
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param param the request object
     */
    public oauthRevokeWithHttpInfo(param: OauthApiOauthRevokeRequest, options?: ConfigurationOptions): Promise<HttpInfo<OauthRevoke200Response>> {
        return this.api.oauthRevokeWithHttpInfo(param.oauthIntrospectRequest,  options).toPromise();
    }

    /**
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param param the request object
     */
    public oauthRevoke(param: OauthApiOauthRevokeRequest, options?: ConfigurationOptions): Promise<OauthRevoke200Response> {
        return this.api.oauthRevoke(param.oauthIntrospectRequest,  options).toPromise();
    }

    /**
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param param the request object
     */
    public oauthTokenWithHttpInfo(param: OauthApiOauthTokenRequest, options?: ConfigurationOptions): Promise<HttpInfo<OauthToken200Response>> {
        return this.api.oauthTokenWithHttpInfo(param.oauthTokenRequest,  options).toPromise();
    }

    /**
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param param the request object
     */
    public oauthToken(param: OauthApiOauthTokenRequest, options?: ConfigurationOptions): Promise<OauthToken200Response> {
        return this.api.oauthToken(param.oauthTokenRequest,  options).toPromise();
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param param the request object
     */
    public registerOauthClientWithHttpInfo(param: OauthApiRegisterOauthClientRequest, options?: ConfigurationOptions): Promise<HttpInfo<RegisterOauthClient201Response>> {
        return this.api.registerOauthClientWithHttpInfo(param.registerOauthClientRequest,  options).toPromise();
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param param the request object
     */
    public registerOauthClient(param: OauthApiRegisterOauthClientRequest, options?: ConfigurationOptions): Promise<RegisterOauthClient201Response> {
        return this.api.registerOauthClient(param.registerOauthClientRequest,  options).toPromise();
    }

}

import { ObservableSystemApi } from "./ObservableAPI";
import { SystemApiRequestFactory, SystemApiResponseProcessor} from "../apis/SystemApi";

export interface SystemApiGetHealthRequest {
}

export interface SystemApiGetMetricsRequest {
}

export interface SystemApiGetOpenApiRequest {
}

export interface SystemApiGetServerInfoRequest {
}

export class ObjectSystemApi {
    private api: ObservableSystemApi

    public constructor(configuration: Configuration, requestFactory?: SystemApiRequestFactory, responseProcessor?: SystemApiResponseProcessor) {
        this.api = new ObservableSystemApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.
     * Liveness and contract health probe
     * @param param the request object
     */
    public getHealthWithHttpInfo(param: SystemApiGetHealthRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<HealthResponse>> {
        return this.api.getHealthWithHttpInfo( options).toPromise();
    }

    /**
     * Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.
     * Liveness and contract health probe
     * @param param the request object
     */
    public getHealth(param: SystemApiGetHealthRequest = {}, options?: ConfigurationOptions): Promise<HealthResponse> {
        return this.api.getHealth( options).toPromise();
    }

    /**
     * Renders Prometheus-formatted operational metrics.
     * Prometheus Metrics
     * @param param the request object
     */
    public getMetricsWithHttpInfo(param: SystemApiGetMetricsRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<string>> {
        return this.api.getMetricsWithHttpInfo( options).toPromise();
    }

    /**
     * Renders Prometheus-formatted operational metrics.
     * Prometheus Metrics
     * @param param the request object
     */
    public getMetrics(param: SystemApiGetMetricsRequest = {}, options?: ConfigurationOptions): Promise<string> {
        return this.api.getMetrics( options).toPromise();
    }

    /**
     * Returns the complete OpenAPI 3.0.3 specification JSON.
     * Get OpenAPI Specification
     * @param param the request object
     */
    public getOpenApiWithHttpInfo(param: SystemApiGetOpenApiRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<any>> {
        return this.api.getOpenApiWithHttpInfo( options).toPromise();
    }

    /**
     * Returns the complete OpenAPI 3.0.3 specification JSON.
     * Get OpenAPI Specification
     * @param param the request object
     */
    public getOpenApi(param: SystemApiGetOpenApiRequest = {}, options?: ConfigurationOptions): Promise<any> {
        return this.api.getOpenApi( options).toPromise();
    }

    /**
     * Returns server version, API versioning info, and supported feature flags.
     * Server capability discovery
     * @param param the request object
     */
    public getServerInfoWithHttpInfo(param: SystemApiGetServerInfoRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<ServerInfo>> {
        return this.api.getServerInfoWithHttpInfo( options).toPromise();
    }

    /**
     * Returns server version, API versioning info, and supported feature flags.
     * Server capability discovery
     * @param param the request object
     */
    public getServerInfo(param: SystemApiGetServerInfoRequest = {}, options?: ConfigurationOptions): Promise<ServerInfo> {
        return this.api.getServerInfo( options).toPromise();
    }

}

import { ObservableWebhooksApi } from "./ObservableAPI";
import { WebhooksApiRequestFactory, WebhooksApiResponseProcessor} from "../apis/WebhooksApi";

export interface WebhooksApiDeleteWebhookRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof WebhooksApideleteWebhook
     */
    id: string
}

export interface WebhooksApiGetWebhookRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof WebhooksApigetWebhook
     */
    id: string
}

export interface WebhooksApiListWebhookLogsRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof WebhooksApilistWebhookLogs
     */
    webhookId?: string
    /**
     * 
     * Defaults to: 50
     * @type number
     * @memberof WebhooksApilistWebhookLogs
     */
    limit?: number
}

export interface WebhooksApiListWebhooksRequest {
}

export interface WebhooksApiRegisterWebhookRequest {
    /**
     * 
     * @type RegisterWebhookRequest
     * @memberof WebhooksApiregisterWebhook
     */
    registerWebhookRequest: RegisterWebhookRequest
}

export interface WebhooksApiTestWebhookRequest {
    /**
     * 
     * Defaults to: undefined
     * @type string
     * @memberof WebhooksApitestWebhook
     */
    id: string
}

export class ObjectWebhooksApi {
    private api: ObservableWebhooksApi

    public constructor(configuration: Configuration, requestFactory?: WebhooksApiRequestFactory, responseProcessor?: WebhooksApiResponseProcessor) {
        this.api = new ObservableWebhooksApi(configuration, requestFactory, responseProcessor);
    }

    /**
     * Delete webhook
     * @param param the request object
     */
    public deleteWebhookWithHttpInfo(param: WebhooksApiDeleteWebhookRequest, options?: ConfigurationOptions): Promise<HttpInfo<DeleteWebhook200Response>> {
        return this.api.deleteWebhookWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Delete webhook
     * @param param the request object
     */
    public deleteWebhook(param: WebhooksApiDeleteWebhookRequest, options?: ConfigurationOptions): Promise<DeleteWebhook200Response> {
        return this.api.deleteWebhook(param.id,  options).toPromise();
    }

    /**
     * Get webhook by ID
     * @param param the request object
     */
    public getWebhookWithHttpInfo(param: WebhooksApiGetWebhookRequest, options?: ConfigurationOptions): Promise<HttpInfo<Webhook>> {
        return this.api.getWebhookWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Get webhook by ID
     * @param param the request object
     */
    public getWebhook(param: WebhooksApiGetWebhookRequest, options?: ConfigurationOptions): Promise<Webhook> {
        return this.api.getWebhook(param.id,  options).toPromise();
    }

    /**
     * Query webhook delivery logs
     * @param param the request object
     */
    public listWebhookLogsWithHttpInfo(param: WebhooksApiListWebhookLogsRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<ListWebhookLogs200Response>> {
        return this.api.listWebhookLogsWithHttpInfo(param.webhookId, param.limit,  options).toPromise();
    }

    /**
     * Query webhook delivery logs
     * @param param the request object
     */
    public listWebhookLogs(param: WebhooksApiListWebhookLogsRequest = {}, options?: ConfigurationOptions): Promise<ListWebhookLogs200Response> {
        return this.api.listWebhookLogs(param.webhookId, param.limit,  options).toPromise();
    }

    /**
     * List registered webhooks
     * @param param the request object
     */
    public listWebhooksWithHttpInfo(param: WebhooksApiListWebhooksRequest = {}, options?: ConfigurationOptions): Promise<HttpInfo<ListWebhooks200Response>> {
        return this.api.listWebhooksWithHttpInfo( options).toPromise();
    }

    /**
     * List registered webhooks
     * @param param the request object
     */
    public listWebhooks(param: WebhooksApiListWebhooksRequest = {}, options?: ConfigurationOptions): Promise<ListWebhooks200Response> {
        return this.api.listWebhooks( options).toPromise();
    }

    /**
     * Register a new webhook endpoint
     * @param param the request object
     */
    public registerWebhookWithHttpInfo(param: WebhooksApiRegisterWebhookRequest, options?: ConfigurationOptions): Promise<HttpInfo<Webhook>> {
        return this.api.registerWebhookWithHttpInfo(param.registerWebhookRequest,  options).toPromise();
    }

    /**
     * Register a new webhook endpoint
     * @param param the request object
     */
    public registerWebhook(param: WebhooksApiRegisterWebhookRequest, options?: ConfigurationOptions): Promise<Webhook> {
        return this.api.registerWebhook(param.registerWebhookRequest,  options).toPromise();
    }

    /**
     * Test webhook delivery
     * @param param the request object
     */
    public testWebhookWithHttpInfo(param: WebhooksApiTestWebhookRequest, options?: ConfigurationOptions): Promise<HttpInfo<WebhookLog>> {
        return this.api.testWebhookWithHttpInfo(param.id,  options).toPromise();
    }

    /**
     * Test webhook delivery
     * @param param the request object
     */
    public testWebhook(param: WebhooksApiTestWebhookRequest, options?: ConfigurationOptions): Promise<WebhookLog> {
        return this.api.testWebhook(param.id,  options).toPromise();
    }

}
