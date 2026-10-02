# RegisterOauthClientRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | [optional] 
**redirect_uris** | **List[str]** |  | 
**scopes** | **List[str]** | Subset of the API&#39;s scopes this client may ever be granted. | [optional] 
**grant_types** | **List[str]** |  | [optional] 

## Example

```python
from soroban_identity_client.models.register_oauth_client_request import RegisterOauthClientRequest

# TODO update the JSON string below
json = "{}"
# create an instance of RegisterOauthClientRequest from a JSON string
register_oauth_client_request_instance = RegisterOauthClientRequest.from_json(json)
# print the JSON string representation of the object
print(RegisterOauthClientRequest.to_json())

# convert the object into a dict
register_oauth_client_request_dict = register_oauth_client_request_instance.to_dict()
# create an instance of RegisterOauthClientRequest from a dict
register_oauth_client_request_from_dict = RegisterOauthClientRequest.from_dict(register_oauth_client_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


