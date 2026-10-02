// TODO: better import syntax?
import {BaseAPIRequestFactory, RequiredError, COLLECTION_FORMATS} from './baseapi';
import {Configuration} from '../configuration';
import {RequestContext, HttpMethod, ResponseContext, HttpFile, HttpInfo} from '../http/http';
import {ObjectSerializer} from '../models/ObjectSerializer';
import {ApiException} from './exception';
import {canConsumeForm, isCodeInRange} from '../util';
import {SecurityAuthentication} from '../auth/auth';


import { ResolveDid200Response } from '../models/ResolveDid200Response';

/**
 * no description
 */
export class IdentityApiRequestFactory extends BaseAPIRequestFactory {

    /**
     * W3C DID Resolution endpoint for did:stellar identifiers.
     * Resolve a DID document
     * @param did 
     */
    public async resolveDid(did: string, _options?: Configuration): Promise<RequestContext> {
        let _config = _options || this.configuration;

        // verify required parameter 'did' is not null or undefined
        if (did === null || did === undefined) {
            throw new RequiredError("IdentityApi", "resolveDid", "did");
        }


        // Path Params
        const localVarPath = '/1.0/identifiers/{did}'
            .replace('{did}', encodeURIComponent(String(did)));

        // Make Request Context
        const requestContext = _config.baseServer.makeRequestContext(localVarPath, HttpMethod.GET);
        requestContext.setHeaderParam("Accept", "application/json, */*;q=0.8")


        
        const defaultAuth: SecurityAuthentication | undefined = _config?.authMethods?.default
        if (defaultAuth?.applySecurityAuthentication) {
            await defaultAuth?.applySecurityAuthentication(requestContext);
        }

        return requestContext;
    }

}

export class IdentityApiResponseProcessor {

    /**
     * Unwraps the actual response sent by the server from the response context and deserializes the response content
     * to the expected objects
     *
     * @params response Response returned by the server for a request to resolveDid
     * @throws ApiException if the response code was not in [200, 299]
     */
     public async resolveDidWithHttpInfo(response: ResponseContext): Promise<HttpInfo<ResolveDid200Response >> {
        const contentType = ObjectSerializer.normalizeMediaType(response.headers["content-type"]);
        if (isCodeInRange("200", response.httpStatusCode)) {
            const body: ResolveDid200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ResolveDid200Response", ""
            ) as ResolveDid200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }
        if (isCodeInRange("400", response.httpStatusCode)) {
            throw new ApiException<undefined>(response.httpStatusCode, "Invalid DID format", undefined, response.headers);
        }
        if (isCodeInRange("502", response.httpStatusCode)) {
            throw new ApiException<undefined>(response.httpStatusCode, "Upstream RPC failure", undefined, response.headers);
        }

        // Work around for missing responses in specification, e.g. for petstore.yaml
        if (response.httpStatusCode >= 200 && response.httpStatusCode <= 299) {
            const body: ResolveDid200Response = ObjectSerializer.deserialize(
                ObjectSerializer.parse(await response.body.text(), contentType),
                "ResolveDid200Response", ""
            ) as ResolveDid200Response;
            return new HttpInfo(response.httpStatusCode, response.headers, response.body, body);
        }

        throw new ApiException<string | Blob | undefined>(response.httpStatusCode, "Unknown API Status Code!", await response.getBodyAsAny(), response.headers);
    }

}
