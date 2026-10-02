# ExecuteBatchRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**atomic** | **bool** | Stop at the first failure and revoke any credentials issued earlier in this batch, instead of continuing through the remaining operations. | [optional] 
**operations** | [**List[ExecuteBatchRequestOperationsInner]**](ExecuteBatchRequestOperationsInner.md) |  | 

## Example

```python
from soroban_identity_client.models.execute_batch_request import ExecuteBatchRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteBatchRequest from a JSON string
execute_batch_request_instance = ExecuteBatchRequest.from_json(json)
# print the JSON string representation of the object
print(ExecuteBatchRequest.to_json())

# convert the object into a dict
execute_batch_request_dict = execute_batch_request_instance.to_dict()
# create an instance of ExecuteBatchRequest from a dict
execute_batch_request_from_dict = ExecuteBatchRequest.from_dict(execute_batch_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


