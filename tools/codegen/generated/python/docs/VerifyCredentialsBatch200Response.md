# VerifyCredentialsBatch200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**results** | [**List[VerifyCredentialsBatch200ResponseResultsInner]**](VerifyCredentialsBatch200ResponseResultsInner.md) |  | 
**total** | **int** |  | 
**verified_count** | **int** |  | 

## Example

```python
from soroban_identity_client.models.verify_credentials_batch200_response import VerifyCredentialsBatch200Response

# TODO update the JSON string below
json = "{}"
# create an instance of VerifyCredentialsBatch200Response from a JSON string
verify_credentials_batch200_response_instance = VerifyCredentialsBatch200Response.from_json(json)
# print the JSON string representation of the object
print(VerifyCredentialsBatch200Response.to_json())

# convert the object into a dict
verify_credentials_batch200_response_dict = verify_credentials_batch200_response_instance.to_dict()
# create an instance of VerifyCredentialsBatch200Response from a dict
verify_credentials_batch200_response_from_dict = VerifyCredentialsBatch200Response.from_dict(verify_credentials_batch200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


