# CredentialVerifyResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**verified** | **bool** | True if valid, active, and unexpired | 
**reason** | **str** |  | [optional] 
**credential** | [**Credential**](Credential.md) |  | [optional] 

## Example

```python
from soroban_identity_client.models.credential_verify_response import CredentialVerifyResponse

# TODO update the JSON string below
json = "{}"
# create an instance of CredentialVerifyResponse from a JSON string
credential_verify_response_instance = CredentialVerifyResponse.from_json(json)
# print the JSON string representation of the object
print(CredentialVerifyResponse.to_json())

# convert the object into a dict
credential_verify_response_dict = credential_verify_response_instance.to_dict()
# create an instance of CredentialVerifyResponse from a dict
credential_verify_response_from_dict = CredentialVerifyResponse.from_dict(credential_verify_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


