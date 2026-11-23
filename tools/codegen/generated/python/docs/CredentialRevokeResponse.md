# CredentialRevokeResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**revoked** | **bool** |  | 
**credential** | [**Credential**](Credential.md) |  | 

## Example

```python
from soroban_identity_client.models.credential_revoke_response import CredentialRevokeResponse

# TODO update the JSON string below
json = "{}"
# create an instance of CredentialRevokeResponse from a JSON string
credential_revoke_response_instance = CredentialRevokeResponse.from_json(json)
# print the JSON string representation of the object
print(CredentialRevokeResponse.to_json())

# convert the object into a dict
credential_revoke_response_dict = credential_revoke_response_instance.to_dict()
# create an instance of CredentialRevokeResponse from a dict
credential_revoke_response_from_dict = CredentialRevokeResponse.from_dict(credential_revoke_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


