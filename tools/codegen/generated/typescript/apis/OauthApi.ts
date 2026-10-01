// TODO: better import syntax?
import {BaseAPIRequestFactory, RequiredError, COLLECTION_FORMATS} from './baseapi';
import {Configuration} from '../configuration';
import {RequestContext, HttpMethod, ResponseContext, HttpFile, HttpInfo} from '../http/http';
import {ObjectSerializer} from '../models/ObjectSerializer';
import {ApiException} from './exception';
import {canConsumeForm, isCodeInRange} from '../util';
import {SecurityAuthentication} from '../auth/auth';


import { ErrorResponse } from '../models/ErrorResponse';
import { OauthIntrospect200Response } from '../models/OauthIntrospect200Response';
import { OauthIntrospectRequest } from '../models/OauthIntrospectRequest';
import { OauthRevoke200Response } from '../models/OauthRevoke200Response';
import { OauthToken200Response } from '../models/OauthToken200Response';
import { OauthTokenRequest } from '../models/OauthTokenRequest';
import { RegisterOauthClient201Response } from '../models/RegisterOauthClient201Response';
import { RegisterOauthClientRequest } from '../models/RegisterOauthClientRequest';

/**
 * no description
 */
export class OauthApiRequestFactory extends BaseAPIRequestFactory {

    /**
     * Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client\'s registered scopes and the caller\'s own.
     * Authorization endpoint (authorization code grant)
     * @param responseType 
     * @param clientId 
     * @param redirectUri 
     * @param scope Space-delimited scopes. Defaults to the client\&#39;s full registered scope set.
     * @param state Opaque value echoed back unchanged, to protect against CSRF.
     */
    public async oauthAuthorize(responseType: 'code', clientId: string, redirectUri: string, scope?: string, state?: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'responseType' is not null or undefined
        if (responseType === null || responseType === undefined) {
            throw new RequiredError("OauthApi", "oauthAuthorize", "responseType");
        }


        // verify required parameter 'clientId' is not null or undefined
        if (clientId === null || clientId === undefined) {
            throw new RequiredError("OauthApi", "oauthAuthorize", "clientId");
        }


        // verify required parameter 'redirectUri' is not null or undefined
        if (redirectUri === null || redirectUri === undefined) {
            throw new RequiredError("OauthApi", "oauthAuthorize", "redirectUri");
        }




        // Path Params
        const localVarPath = '/oauth/authorize';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.GET);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")

        // Query Params
        if (responseType !== undefined) {
            requestContext.setQueryParam("response_type", ObjectSerializer.serialize(responseType, "'code'", ""));
        }

        // Query Params
        if (clientId !== undefined) {
            requestContext.setQueryParam("client_id", ObjectSerializer.serialize(clientId, "string", ""));
        }

        // Query Params
        if (redirectUri !== undefined) {
            requestContext.setQueryParam("redirect_uri", ObjectSerializer.serialize(redirectUri, "string", "uri"));
        }

        // Query Params
        if (scope !== undefined) {
            requestContext.setQueryParam("scope", ObjectSerializer.serialize(scope, "string", ""));
        }

        // Query Params
        if (state !== undefined) {
            requestContext.setQueryParam("state", ObjectSerializer.serialize(state, "string", ""));
        }


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
     * Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).
     * Token introspection (RFC 7662)
     * @param oauthIntrospectRequest 
     */
    public async oauthIntrospect(oauthIntrospectRequest: OauthIntrospectRequest, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'oauthIntrospectRequest' is not null or undefined
        if (oauthIntrospectRequest === null || oauthIntrospectRequest === undefined) {
            throw new RequiredError("OauthApi", "oauthIntrospect", "oauthIntrospectRequest");
        }


        // Path Params
        const localVarPath = '/oauth/introspect';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        // Body Params
        const contentType = ObjectSerializer.getPreferredMediaType([
            "application/json"
        ]);
        requestContext.setHeaderParam("Content-Type", contentType);
        const serializedBody = ObjectSerializer.stringify(
            ObjectSerializer.serialize(oauthIntrospectRequest, "OauthIntrospectRequest", ""),
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
     * Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.
     * Token revocation (RFC 7009)
     * @param oauthIntrospectRequest 
     */
    public async oauthRevoke(oauthIntrospectRequest: OauthIntrospectRequest, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'oauthIntrospectRequest' is not null or undefined
        if (oauthIntrospectRequest === null || oauthIntrospectRequest === undefined) {
            throw new RequiredError("OauthApi", "oauthRevoke", "oauthIntrospectRequest");
        }


        // Path Params
        const localVarPath = '/oauth/revoke';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        // Body Params
        const contentType = ObjectSerializer.getPreferredMediaType([
            "application/json"
        ]);
        requestContext.setHeaderParam("Content-Type", contentType);
        const serializedBody = ObjectSerializer.stringify(
            ObjectSerializer.serialize(oauthIntrospectRequest, "OauthIntrospectRequest", ""),
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
     * Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.
     * Token endpoint
     * @param oauthTokenRequest 
     */
    public async oauthToken(oauthTokenRequest: OauthTokenRequest, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'oauthTokenRequest' is not null or undefined
        if (oauthTokenRequest === null || oauthTokenRequest === undefined) {
            throw new RequiredError("OauthApi", "oauthToken", "oauthTokenRequest");
        }


        // Path Params
        const localVarPath = '/oauth/token';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        // Body Params
        const contentType = ObjectSerializer.getPreferredMediaType([
            "application/json"
        ]);
        requestContext.setHeaderParam("Content-Type", contentType);
        const serializedBody = ObjectSerializer.stringify(
            ObjectSerializer.serialize(oauthTokenRequest, "OauthTokenRequest", ""),
            contentType
        );
        requestContext.setBody(serializedBody);

        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

    /**
     * Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.
     * Register an OAuth 2.0 client
     * @param registerOauthClientRequest 
     */
    public async registerOauthClient(registerOauthClientRequest: RegisterOauthClientRequest, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'registerOauthClientRequest' is not null or undefined
        if (registerOauthClientRequest === null || registerOauthClientRequest === undefined) {
            throw new RequiredError("OauthApi", "registerOauthClient", "registerOauthClientRequest");
        }


        // Path Params
        const localVarPath = '/oauth/clients';

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.POST);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        // Body Params
        const contentType = ObjectSerializer.getPreferredMediaType([
            "application/json"
        ]);
        requestContext.setHeaderParam("Content-Type", contentType);
        const serializedBody = ObjectSerializer.stringify(
            ObjectSerializer.serialize(registerOauthClientRequest, "RegisterOauthClientRequest", ""),
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

}

export class OauthApiResponseProcessor {

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to oauthAuthorize
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async oauthAuthorizeWithHttpInfo(response: ResponseContext): Promise<HttpInfo< void>> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("302", response.httpStatusCode)) {
            throw new ApiException<undefined>(response.httpStatusCode, "Redirect to redirect_uri with code and state query parameters.", undefined, response.headers);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Invalid request, unknown client, or unregistered redirect_uri", body, response.headers);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing or invalid credentials", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Caller does not hold a requested scope", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, undefined);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to oauthIntrospect
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async oauthIntrospectWithHttpInfo(response: ResponseContext): Promise<HttpInfo<OauthIntrospect200Response >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: OauthIntrospect200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "OauthIntrospect200Response", ""
            ) as OauthIntrospect200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing or invalid credentials", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: OauthIntrospect200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "OauthIntrospect200Response", ""
            ) as OauthIntrospect200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to oauthRevoke
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async oauthRevokeWithHttpInfo(response: ResponseContext): Promise<HttpInfo<OauthRevoke200Response >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: OauthRevoke200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "OauthRevoke200Response", ""
            ) as OauthRevoke200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing or invalid credentials", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: OauthRevoke200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "OauthRevoke200Response", ""
            ) as OauthRevoke200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to oauthToken
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async oauthTokenWithHttpInfo(response: ResponseContext): Promise<HttpInfo<OauthToken200Response >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: OauthToken200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "OauthToken200Response", ""
            ) as OauthToken200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "invalid_request / invalid_grant / invalid_scope", body, response.headers);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "invalid_client", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: OauthToken200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "OauthToken200Response", ""
            ) as OauthToken200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to registerOauthClient
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async registerOauthClientWithHttpInfo(response: ResponseContext): Promise<HttpInfo<RegisterOauthClient201Response >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("201", response.httpStatusCode)) {
            const body: RegisterOauthClient201Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "RegisterOauthClient201Response", ""
            ) as RegisterOauthClient201Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Invalid registration request", body, response.headers);
        }
        if (isCodeInRange("401", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing or invalid credentials", body, response.headers);
        }
        if (isCodeInRange("403", response.httpStatusCode)) {
            const body: ErrorResponse = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ErrorResponse", ""
            ) as ErrorResponse;
            throw new ApiException<ErrorResponse>(response.httpStatusCode, "Missing admin:write scope", body, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: RegisterOauthClient201Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "RegisterOauthClient201Response", ""
            ) as RegisterOauthClient201Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

}
