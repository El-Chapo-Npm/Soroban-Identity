# ExecuteBatchRequestOperationsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** | Optional client-supplied reference echoed back on the matching result. | [optional] 
**type** | **str** |  | 
**payload** | **object** | issue: a full credential body. verify/revoke: { credentialId }. | 

## Example

```python
from soroban_identity_client.models.execute_batch_request_operations_inner import ExecuteBatchRequestOperationsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteBatchRequestOperationsInner from a JSON string
execute_batch_request_operations_inner_instance = ExecuteBatchRequestOperationsInner.from_json(json)
# print the JSON string representation of the object
print(ExecuteBatchRequestOperationsInner.to_json())

# convert the object into a dict
execute_batch_request_operations_inner_dict = execute_batch_request_operations_inner_instance.to_dict()
# create an instance of ExecuteBatchRequestOperationsInner from a dict
execute_batch_request_operations_inner_from_dict = ExecuteBatchRequestOperationsInner.from_dict(execute_batch_request_operations_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


