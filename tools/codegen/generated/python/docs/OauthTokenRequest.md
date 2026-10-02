# OauthTokenRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**grant_type** | **str** |  | 
**code** | **str** | Required for grant_type&#x3D;authorization_code | [optional] 
**redirect_uri** | **str** | Required for grant_type&#x3D;authorization_code; must match the value used at /oauth/authorize | [optional] 
**refresh_token** | **str** | Required for grant_type&#x3D;refresh_token | [optional] 
**client_id** | **str** |  | 
**client_secret** | **str** |  | 
**scope** | **str** | Optional on refresh; may only narrow the original grant | [optional] 

## Example

```python
from soroban_identity_client.models.oauth_token_request import OauthTokenRequest

# TODO update the JSON string below
json = "{}"
# create an instance of OauthTokenRequest from a JSON string
oauth_token_request_instance = OauthTokenRequest.from_json(json)
# print the JSON string representation of the object
print(OauthTokenRequest.to_json())

# convert the object into a dict
oauth_token_request_dict = oauth_token_request_instance.to_dict()
# create an instance of OauthTokenRequest from a dict
oauth_token_request_from_dict = OauthTokenRequest.from_dict(oauth_token_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


