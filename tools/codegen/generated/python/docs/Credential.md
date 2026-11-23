# Credential


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**subject** | **str** |  | 
**issuer** | **str** |  | 
**expires_at** | **float** |  | [optional] 
**revoked** | **bool** |  | [optional] 
**revoked_at** | **datetime** |  | [optional] 
**var_schema** | **str** |  | [optional] 
**claims** | **object** |  | [optional] 
**source** | **str** |  | [optional] 
**expiry_notified_at** | **datetime** |  | [optional] 

## Example

```python
from soroban_identity_client.models.credential import Credential

# TODO update the JSON string below
json = "{}"
# create an instance of Credential from a JSON string
credential_instance = Credential.from_json(json)
# print the JSON string representation of the object
print(Credential.to_json())

# convert the object into a dict
credential_dict = credential_instance.to_dict()
# create an instance of Credential from a dict
credential_from_dict = Credential.from_dict(credential_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


