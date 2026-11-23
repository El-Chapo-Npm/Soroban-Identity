# VerifyCredentialsBatchRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**ids** | **List[str]** |  | 

## Example

```python
from soroban_identity_client.models.verify_credentials_batch_request import VerifyCredentialsBatchRequest

# TODO update the JSON string below
json = "{}"
# create an instance of VerifyCredentialsBatchRequest from a JSON string
verify_credentials_batch_request_instance = VerifyCredentialsBatchRequest.from_json(json)
# print the JSON string representation of the object
print(VerifyCredentialsBatchRequest.to_json())

# convert the object into a dict
verify_credentials_batch_request_dict = verify_credentials_batch_request_instance.to_dict()
# create an instance of VerifyCredentialsBatchRequest from a dict
verify_credentials_batch_request_from_dict = VerifyCredentialsBatchRequest.from_dict(verify_credentials_batch_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


