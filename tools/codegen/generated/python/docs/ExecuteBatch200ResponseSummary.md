# ExecuteBatch200ResponseSummary


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total** | **int** |  | [optional] 
**succeeded** | **int** |  | [optional] 
**failed** | **int** |  | [optional] 

## Example

```python
from soroban_identity_client.models.execute_batch200_response_summary import ExecuteBatch200ResponseSummary

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteBatch200ResponseSummary from a JSON string
execute_batch200_response_summary_instance = ExecuteBatch200ResponseSummary.from_json(json)
# print the JSON string representation of the object
print(ExecuteBatch200ResponseSummary.to_json())

# convert the object into a dict
execute_batch200_response_summary_dict = execute_batch200_response_summary_instance.to_dict()
# create an instance of ExecuteBatch200ResponseSummary from a dict
execute_batch200_response_summary_from_dict = ExecuteBatch200ResponseSummary.from_dict(execute_batch200_response_summary_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


