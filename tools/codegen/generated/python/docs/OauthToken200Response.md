# OauthToken200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**access_token** | **str** |  | [optional] 
**token_type** | **str** |  | [optional] 
**expires_in** | **int** | Seconds until access_token expires | [optional] 
**refresh_token** | **str** |  | [optional] 
**scope** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.oauth_token200_response import OauthToken200Response

# TODO update the JSON string below
json = "{}"
# create an instance of OauthToken200Response from a JSON string
oauth_token200_response_instance = OauthToken200Response.from_json(json)
# print the JSON string representation of the object
print(OauthToken200Response.to_json())

# convert the object into a dict
oauth_token200_response_dict = oauth_token200_response_instance.to_dict()
# create an instance of OauthToken200Response from a dict
oauth_token200_response_from_dict = OauthToken200Response.from_dict(oauth_token200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


