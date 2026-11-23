# ExecuteBatch200ResponseResultsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | [optional] 
**type** | **str** |  | [optional] 
**success** | **bool** |  | [optional] 
**status** | **str** |  | [optional] 
**data** | **object** |  | [optional] 
**error** | **object** |  | [optional] 

## Example

```python
from soroban_identity_client.models.execute_batch200_response_results_inner import ExecuteBatch200ResponseResultsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteBatch200ResponseResultsInner from a JSON string
execute_batch200_response_results_inner_instance = ExecuteBatch200ResponseResultsInner.from_json(json)
# print the JSON string representation of the object
print(ExecuteBatch200ResponseResultsInner.to_json())

# convert the object into a dict
execute_batch200_response_results_inner_dict = execute_batch200_response_results_inner_instance.to_dict()
# create an instance of ExecuteBatch200ResponseResultsInner from a dict
execute_batch200_response_results_inner_from_dict = ExecuteBatch200ResponseResultsInner.from_dict(execute_batch200_response_results_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


