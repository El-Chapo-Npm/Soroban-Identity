# RegisterOauthClient201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**client_id** | **str** |  | [optional] 
**client_secret** | **str** |  | [optional] 
**name** | **str** |  | [optional] 
**redirect_uris** | **List[str]** |  | [optional] 
**scopes** | **List[str]** |  | [optional] 
**grant_types** | **List[str]** |  | [optional] 
**created_at** | **datetime** |  | [optional] 

## Example

```python
from soroban_identity_client.models.register_oauth_client201_response import RegisterOauthClient201Response

# TODO update the JSON string below
json = "{}"
# create an instance of RegisterOauthClient201Response from a JSON string
register_oauth_client201_response_instance = RegisterOauthClient201Response.from_json(json)
# print the JSON string representation of the object
print(RegisterOauthClient201Response.to_json())

# convert the object into a dict
register_oauth_client201_response_dict = register_oauth_client201_response_instance.to_dict()
# create an instance of RegisterOauthClient201Response from a dict
register_oauth_client201_response_from_dict = RegisterOauthClient201Response.from_dict(register_oauth_client201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


