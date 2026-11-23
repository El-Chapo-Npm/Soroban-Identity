# OauthRevoke200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**revoked** | **bool** |  | [optional] 

## Example

```python
from soroban_identity_client.models.oauth_revoke200_response import OauthRevoke200Response

# TODO update the JSON string below
json = "{}"
# create an instance of OauthRevoke200Response from a JSON string
oauth_revoke200_response_instance = OauthRevoke200Response.from_json(json)
# print the JSON string representation of the object
print(OauthRevoke200Response.to_json())

# convert the object into a dict
oauth_revoke200_response_dict = oauth_revoke200_response_instance.to_dict()
# create an instance of OauthRevoke200Response from a dict
oauth_revoke200_response_from_dict = OauthRevoke200Response.from_dict(oauth_revoke200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


