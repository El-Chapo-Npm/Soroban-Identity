# GraphqlPostRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**query** | **str** |  | 
**variables** | **object** |  | [optional] 
**operation_name** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.graphql_post_request import GraphqlPostRequest

# TODO update the JSON string below
json = "{}"
# create an instance of GraphqlPostRequest from a JSON string
graphql_post_request_instance = GraphqlPostRequest.from_json(json)
# print the JSON string representation of the object
print(GraphqlPostRequest.to_json())

# convert the object into a dict
graphql_post_request_dict = graphql_post_request_instance.to_dict()
# create an instance of GraphqlPostRequest from a dict
graphql_post_request_from_dict = GraphqlPostRequest.from_dict(graphql_post_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


