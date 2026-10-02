# OauthIntrospectRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**token** | **str** |  | 
**token_type_hint** | **str** |  | [optional] 
**client_id** | **str** |  | [optional] 
**client_secret** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.oauth_introspect_request import OauthIntrospectRequest

# TODO update the JSON string below
json = "{}"
# create an instance of OauthIntrospectRequest from a JSON string
oauth_introspect_request_instance = OauthIntrospectRequest.from_json(json)
# print the JSON string representation of the object
print(OauthIntrospectRequest.to_json())

# convert the object into a dict
oauth_introspect_request_dict = oauth_introspect_request_instance.to_dict()
# create an instance of OauthIntrospectRequest from a dict
oauth_introspect_request_from_dict = OauthIntrospectRequest.from_dict(oauth_introspect_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


