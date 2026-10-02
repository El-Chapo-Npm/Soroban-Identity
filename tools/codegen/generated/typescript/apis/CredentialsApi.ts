// TODO: better import syntax?
import {BaseAPIRequestFactory, RequiredError, COLLECTION_FORMATS} from './baseapi';
import {Configuration} from '../configuration';
import {RequestContext, HttpMethod, ResponseContext, HttpFile, HttpInfo} from '../http/http';
import {ObjectSerializer} from '../models/ObjectSerializer';
import {ApiException} from './exception';
import {canConsumeForm, isCodeInRange} from '../util';
import {SecurityAuthentication} from '../auth/auth';


import { Credential } from '../models/Credential';
import { CredentialRevokeResponse } from '../models/CredentialRevokeResponse';
import { CredentialVerifyResponse } from '../models/CredentialVerifyResponse';
import { ErrorResponse } from '../models/ErrorResponse';
import { IssueCredentialRequest } from '../models/IssueCredentialRequest';
import { PaginatedCredentials } from '../models/PaginatedCredentials';

/**
 * no description
 */
export class CredentialsApiRequestFactory extends BaseAPIRequestFactory {

    /**
     * Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.
     * Revoke a credential
     * @param id Unique identifier of the credential
     * @param ifMatch Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag.
     */
    public async deleteCredential(id: string, ifMatch?: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'id' is not null or undefined
        if (id === null || id === undefined) {
            throw new RequiredError("CredentialsApi", "deleteCredential", "id");
        }



        // Path Params
        const localVarPath = '/credentials/{id}'
            .replace('{id}', encodeURIComponent(String(id)));

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.DELETE);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")

        // Header Params
        requestContext.setHeaderParam("If-Match", ObjectSerializer.serialize(ifMatch, "string", ""));


        let authMethod: SecurityAuthentication | undefined;
        // Apply auth methods
        authMethod = _config.authMethods["ApiKeyAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        // Apply auth methods
        authMethod = _config.authMethods["BearerAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Explicit revocation path matching DELETE /credentials/:id/revoke.
     * Revoke a credential via DELETE
     * @param id 
     */
    public async deleteCredentialRevocation(id: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'id' is not null or undefined
        if (id === null || id === undefined) {
            throw new RequiredError("CredentialsApi", "deleteCredentialRevocation", "id");
        }


        // Path Params
        const localVarPath = '/credentials/{id}/revoke'
            .replace('{id}', encodeURIComponent(String(id)));

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.DELETE);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        let authMethod: SecurityAuthentication | undefined;
        // Apply auth methods
        authMethod = _config.authMethods["ApiKeyAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Retrieves the full record of an existing credential.
     * Get credential by ID
     * @param id Unique identifier of the credential
     * @param fields Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects.
     * @param ifNoneMatch Conditional GET. When it matches the current strong ETag, the server returns 304 with no body.
     */
    public async getCredential(id: string, fields?: string, ifNoneMatch?: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'id' is not null or undefined
        if (id === null || id === undefined) {
            throw new RequiredError("CredentialsApi", "getCredential", "id");
        }




        // Path Params
        const localVarPath = '/credentials/{id}'
            .replace('{id}', encodeURIComponent(String(id)));

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.GET);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")

        // Query Params
        if (fields !== undefined) {
            requestContext.setQueryParam("fields", ObjectSerializer.serialize(fields, "string", ""));
        }

        // Header Params
        requestContext.setHeaderParam("If-None-Match", ObjectSerializer.serialize(ifNoneMatch, "string", ""));


        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.
     * Issue a new Verifiable Credential
     * @param issueCredentialRequest 
     */
    public async issueCredential(issueCredentialRequest: IssueCredentialRequest, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'issueCredentialRequest' is not null or undefined
        if (issueCredentialRequest === null || issueCredentialRequest === undefined) {
            throw new RequiredError("CredentialsApi", "issueCredential", "issueCredentialRequest");
        }


        // Path Params
        const localVarPath = '/credentials';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        // Body Params
        const contentType = ObjectSerializer.getPreferredMediaType([
            "application/json"
        ]);
        requestContext.setHeaderParam("Content-Type", contentType);
        const serializedBody = ObjectSerializer.stringify(
            ObjectSerializer.serialize(issueCredentialRequest, "IssueCredentialRequest", ""),
            contentType
        );
        requestContext.setBody(serializedBody);

        let authMethod: SecurityAuthentication | undefined;
        // Apply auth methods
        authMethod = _config.authMethods["ApiKeyAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        // Apply auth methods
        authMethod = _config.authMethods["BearerAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Alias route for credential issuance.
     * Issue a credential (alias for POST /credentials)
     * @param issueCredentialRequest 
     */
    public async issueCredentialAlias(issueCredentialRequest: IssueCredentialRequest, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'issueCredentialRequest' is not null or undefined
        if (issueCredentialRequest === null || issueCredentialRequest === undefined) {
            throw new RequiredError("CredentialsApi", "issueCredentialAlias", "issueCredentialRequest");
        }


        // Path Params
        const localVarPath = '/credentials/issue';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        // Body Params
        const contentType = ObjectSerializer.getPreferredMediaType([
            "application/json"
        ]);
        requestContext.setHeaderParam("Content-Type", contentType);
        const serializedBody = ObjectSerializer.stringify(
            ObjectSerializer.serialize(issueCredentialRequest, "IssueCredentialRequest", ""),
            contentType
        );
        requestContext.setBody(serializedBody);

        let authMethod: SecurityAuthentication | undefined;
        // Apply auth methods
        authMethod = _config.authMethods["ApiKeyAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.
     * List credentials (cursor-paginated)
     * @param limit Number of records to return (max 200)
     * @param cursor Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor
     * @param direction Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order.
     * @param fields Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object.
     */
    public async listCredentials(limit?: number, cursor?: string, direction?: 'next' | 'prev', fields?: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;





        // Path Params
        const localVarPath = '/credentials';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.GET);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")

        // Query Params
        if (limit !== undefined) {
            requestContext.setQueryParam("limit", ObjectSerializer.serialize(limit, "number", ""));
        }

        // Query Params
        if (cursor !== undefined) {
            requestContext.setQueryParam("cursor", ObjectSerializer.serialize(cursor, "string", ""));
        }

        // Query Params
        if (direction !== undefined) {
            requestContext.setQueryParam("direction", ObjectSerializer.serialize(direction, "'next' | 'prev'", ""));
        }

        // Query Params
        if (fields !== undefined) {
            requestContext.setQueryParam("fields", ObjectSerializer.serialize(fields, "string", ""));
        }


        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Alias endpoint for credential revocation.
     * Revoke a credential via POST
     * @param id 
     */
    public async revokeCredential(id: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'id' is not null or undefined
        if (id === null || id === undefined) {
            throw new RequiredError("CredentialsApi", "revokeCredential", "id");
        }


        // Path Params
        const localVarPath = '/credentials/{id}/revoke'
            .replace('{id}', encodeURIComponent(String(id)));

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        let authMethod: SecurityAuthentication | undefined;
        // Apply auth methods
        authMethod = _config.authMethods["ApiKeyAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.
     * Verify credential status
     * @param id Identifier of the credential to verify
     */
    public async verifyCredential(id: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'id' is not null or undefined
        if (id === null || id === undefined) {
            throw new RequiredError("CredentialsApi", "verifyCredential", "id");
        }


        // Path Params
        const localVarPath = '/credentials/{id}/verify'
            .replace('{id}', encodeURIComponent(String(id)));

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        let authMethod: SecurityAuthentication | undefined;
        // Apply auth methods
        authMethod = _config.authMethods["ApiKeyAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        // Apply auth methods
        authMethod = _config.authMethods["BearerAuth"]
        if (authMethod?.applySecurityAuthentication) {
            await authMethod?.applySecurityAuthentication(requestContext);
        }
        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

}

export class CredentialsApiResponseProcessor {

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to deleteCredential
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async deleteCredentialWithHttpInfo(response: ResponseContext): Promise<HttpInfo<CredentialRevokeResponse >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: CredentialRevokeResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialRevokeResponse", ""
            ) as CredentialRevokeResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Unauthorized - missing or invalid API key", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Forbidden - missing credentials:write scope", body, response.headers);
        }
        if (isCodeInRange("404", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Credential not found", body, response.headers);
        }
        if (isCodeInRange("412", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Precondition Failed - If-Match did not match the credential\&#39;s current ETag.", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: CredentialRevokeResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialRevokeResponse", ""
            ) as CredentialRevokeResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to deleteCredentialRevocation
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async deleteCredentialRevocationWithHttpInfo(response: ResponseContext): Promise<HttpInfo<CredentialRevokeResponse >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: CredentialRevokeResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialRevokeResponse", ""
            ) as CredentialRevokeResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Unauthorized - missing or invalid API key", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Forbidden - missing credentials:write scope", body, response.headers);
        }
        if (isCodeInRange("404", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Credential not found", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: CredentialRevokeResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialRevokeResponse", ""
            ) as CredentialRevokeResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to getCredential
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async getCredentialWithHttpInfo(response: ResponseContext): Promise<HttpInfo<Credential >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: Credential = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "Credential", ""
            ) as Credential;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("304", response.httpStatusCode)) {
            throw new ApiException<undefined>(response.httpStatusCode, "Not Modified - If-None-Match matched the current ETag.", undefined, response.headers);
        }
        if (isCodeInRange("404", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Credential not found", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: Credential = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "Credential", ""
            ) as Credential;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to issueCredential
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async issueCredentialWithHttpInfo(response: ResponseContext): Promise<HttpInfo<Credential >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("201", response.httpStatusCode)) {
            const body: Credential = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "Credential", ""
            ) as Credential;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing required fields or invalid body format", body, response.headers);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing or invalid API key authentication token", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "API key lacks required scope (\&#39;credentials:write\&#39;)", body, response.headers);
        }
        if (isCodeInRange("409", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Credential with the given ID already exists", body, response.headers);
        }
        if (isCodeInRange("413", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Request body exceeds maximum payload size limit", body, response.headers);
        }
        if (isCodeInRange("415", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Unsupported Media Type (must be application/json)", body, response.headers);
        }
        if (isCodeInRange("500", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Internal server or storage failure", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: Credential = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "Credential", ""
            ) as Credential;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to issueCredentialAlias
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async issueCredentialAliasWithHttpInfo(response: ResponseContext): Promise<HttpInfo<Credential >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("201", response.httpStatusCode)) {
            const body: Credential = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "Credential", ""
            ) as Credential;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing required fields or invalid body format", body, response.headers);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing or invalid API key authentication token", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "API key lacks required scope (\&#39;credentials:write\&#39;)", body, response.headers);
        }
        if (isCodeInRange("409", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Credential with the given ID already exists", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: Credential = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "Credential", ""
            ) as Credential;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to listCredentials
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async listCredentialsWithHttpInfo(response: ResponseContext): Promise<HttpInfo<PaginatedCredentials >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: PaginatedCredentials = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "PaginatedCredentials", ""
            ) as PaginatedCredentials;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("304", response.httpStatusCode)) {
            throw new ApiException<undefined>(response.httpStatusCode, "Not Modified - the caller\&#39;s If-None-Match matches the current page.", undefined, response.headers);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Invalid query parameters", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: PaginatedCredentials = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "PaginatedCredentials", ""
            ) as PaginatedCredentials;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to revokeCredential
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async revokeCredentialWithHttpInfo(response: ResponseContext): Promise<HttpInfo<CredentialRevokeResponse >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: CredentialRevokeResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialRevokeResponse", ""
            ) as CredentialRevokeResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Unauthorized - missing or invalid API key", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Forbidden - missing credentials:write scope", body, response.headers);
        }
        if (isCodeInRange("404", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Credential not found", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: CredentialRevokeResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialRevokeResponse", ""
            ) as CredentialRevokeResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to verifyCredential
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async verifyCredentialWithHttpInfo(response: ResponseContext): Promise<HttpInfo<CredentialVerifyResponse >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: CredentialVerifyResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialVerifyResponse", ""
            ) as CredentialVerifyResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Unauthorized", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Forbidden - missing credentials:read scope", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: CredentialVerifyResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "CredentialVerifyResponse", ""
            ) as CredentialVerifyResponse;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

}
