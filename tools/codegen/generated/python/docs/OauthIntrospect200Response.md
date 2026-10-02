# OauthIntrospect200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**active** | **bool** |  | [optional] 
**scope** | **str** |  | [optional] 
**client_id** | **str** |  | [optional] 
**token_type** | **str** |  | [optional] 
**exp** | **int** |  | [optional] 
**iat** | **int** |  | [optional] 
**sub** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.oauth_introspect200_response import OauthIntrospect200Response

# TODO update the JSON string below
json = "{}"
# create an instance of OauthIntrospect200Response from a JSON string
oauth_introspect200_response_instance = OauthIntrospect200Response.from_json(json)
# print the JSON string representation of the object
print(OauthIntrospect200Response.to_json())

# convert the object into a dict
oauth_introspect200_response_dict = oauth_introspect200_response_instance.to_dict()
# create an instance of OauthIntrospect200Response from a dict
oauth_introspect200_response_from_dict = OauthIntrospect200Response.from_dict(oauth_introspect200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


